import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Row } from './data';
import type { AccountView } from './account';
import { launchBatches, matches, sessionFor, type Issue } from './issues';
import { TOKEN_PAGE } from './jira';
import type { MachineView } from './machine';
import type { Key } from './runtime/keys';
import { DEFAULTS, type Settings } from './settings';

export type Filter = 'active' | 'all';
export type View = 'list' | 'detail';
export type Tone = 'info' | 'error';
export type Tidy = 'merged' | 'closed' | 'stale';
export type Group = 'needs' | 'live' | 'tidy' | 'done';

export type Page = 'sessions' | 'issues';

export type Input =
  | { kind: 'new'; text: string }
  | { kind: 'jira'; field: 'site' | 'email' | 'token'; site: string; email: string; token: string };

export interface Tracker {
  state: 'connected' | 'disconnected' | 'rejected' | 'unreachable' | 'loading';
  who: string | null;
}

export interface IssuesState {
  list: Issue[];
  /** The selected issue's URL: keys repeat across repos (GH-7 in two of them), URLs don't. */
  selKey: string | null;
  /** Ticked issues, by URL. */
  marks: string[];
  filter: string;
  filtering: boolean;
  jira: Tracker;
  github: Tracker;
  /** The connected Jira site, so a key with no listed issue still links to its ticket. */
  jiraSite: string | null;
  /** Tickets the sessions work on that the list doesn't hold (done, or someone else's). */
  tickets: Issue[];
  loadedAt: number | null;
}

export interface Confirm {
  text: string;
  effects: Effect[];
}

export interface Pending {
  verb: string;
  since: number;
  waitFor: 'session' | 'done';
}

export interface State {
  rows: Row[];
  selId: string | null;
  filter: Filter;
  view: View;
  page: Page;
  issues: IssuesState;
  input: Input | null;
  confirm: Confirm | null;
  menu: number | null;
  marks: string[];
  settings: Settings;
  tidying: string[];
  pending: Record<string, Pending>;
  machine: MachineView | null;
  account: AccountView | null;
  /** A newer release than this one, when the launcher has seen one. */
  update: string | null;
  message: { text: string; tone: Tone } | null;
  loaded: boolean;
  width: number;
  height: number;
  now: number;
}

export type Msg =
  | { type: 'rows'; rows: Row[]; now: number }
  | { type: 'key'; key: Key }
  | { type: 'resize'; width: number; height: number }
  | { type: 'machine'; machine: MachineView; now?: number }
  | { type: 'account'; account: AccountView }
  | { type: 'issues'; list: Issue[]; tickets?: Issue[]; jira: Tracker; github: Tracker; jiraSite?: string | null; now: number }
  | { type: 'done'; label: string }
  | { type: 'message'; text: string; tone: Tone; /** Shown only while this page is open. */ page?: Page };

export type Effect =
  | { type: 'attach'; id: string }
  | { type: 'stop'; id: string }
  | { type: 'launch'; args: string }
  | { type: 'resume'; id: string; sessionId: string; cwd: string; name: string; label: string; prompt: string; stopFirst: boolean }
  | { type: 'cleanup'; id: string; ids: string[]; /** Sessions waiting at a prompt, stopped before removal. */ stop?: string[]; cwd: string; label: string; branch: string | null }
  | { type: 'automerge'; cwd: string; label: string; number: number; on: boolean }
  | { type: 'ready'; cwd: string; label: string; number: number; undo: boolean }
  | { type: 'settings'; settings: Settings }
  | { type: 'open'; url: string }
  | { type: 'refresh' }
  | { type: 'load-issues' }
  | { type: 'launch-batch'; batches: string[] }
  | { type: 'jira-connect'; site: string; email: string; token: string }
  | { type: 'gh-login' }
  | { type: 'quit' };

export interface Step {
  state: State;
  effects: Effect[];
}

export function initialState(width: number, height: number, settings: Settings = DEFAULTS): State {
  return {
    rows: [],
    selId: null,
    filter: 'active',
    view: 'list',
    page: 'sessions',
    issues: {
      list: [],
      selKey: null,
      marks: [],
      filter: '',
      filtering: false,
      jira: { state: 'loading', who: null },
      github: { state: 'loading', who: null },
      jiraSite: null,
      tickets: [],
      loadedAt: null,
    },
    input: null,
    confirm: null,
    menu: null,
    marks: [],
    settings: { ...settings },
    tidying: [],
    pending: {},
    machine: null,
    account: null,
    update: null,
    message: null,
    loaded: false,
    width,
    height,
    now: Date.now(),
  };
}

const RANK: Record<string, number> = { blocked: 0, working: 1, failed: 2, stopped: 3, done: 4 };
const DAY = 24 * 60 * 60 * 1000;
export const STALE_MS = 7 * DAY;

export type Phase = 'fixing-ci' | 'green' | 'awaiting-approval' | 'ci-failing' | 'blocked';

/** Where an open PR's CI leaves the work: the worker's tinker-status line first, the checks when it has none or they have moved on. */
export function phaseOf(r: Row): Phase | null {
  const pr = r.pr && r.pr.state === 'OPEN' ? r.pr : null;
  if (r.state === 'working') return pr?.ci === 'fail' ? 'fixing-ci' : null;
  if (r.state === 'failed' || (r.pr && !pr)) return null;
  const said = r.status?.kind ?? null;
  if (pr?.ci === 'pass') return said === 'blocked' ? 'blocked' : 'green';
  if (said && !(said === 'green' && pr?.ci === 'fail')) return said;
  if (pr?.ci !== 'fail') return null;
  const { fail, gate = 0 } = pr.checks;
  return fail > 0 && gate >= fail ? 'awaiting-approval' : 'ci-failing';
}

/** The PR merged and the worker isn't busy: whatever it is waiting on no longer matters. */
export function landed(r: Row): boolean {
  return r.pr?.state === 'MERGED' && r.state !== 'working';
}

export function needsYou(r: Row): boolean {
  if (landed(r)) return false;
  const phase = phaseOf(r);
  if (phase === 'awaiting-approval' || phase === 'blocked') return true;
  if (phase) return false;
  return r.state === 'blocked' || r.verdict?.kind === 'PARKED';
}

function rankOf(r: Row): number {
  if (needsYou(r)) return 0;
  if (phaseOf(r) === 'ci-failing') return 0.5;
  return r.state === 'blocked' ? RANK.done : (RANK[r.state] ?? 5);
}

export function isLive(r: Row): boolean {
  return r.state === 'working' || r.state === 'blocked';
}

export function tidyOf(r: Row, now: number): Tidy | null {
  if (landed(r)) return 'merged';
  if (isLive(r)) return null;
  if (r.pr?.state === 'MERGED') return 'merged';
  if (r.pr?.state === 'CLOSED') return 'closed';
  if (!r.pr && now - r.startedAt > STALE_MS) return 'stale';
  return null;
}

export function groupOf(r: Row, now: number): Group {
  if (needsYou(r)) return 'needs';
  if (isLive(r)) return 'live';
  if (tidyOf(r, now)) return 'tidy';
  return 'done';
}

export function labelOf(r: Row): string {
  return r.key ?? r.label;
}

export function newest(rows: Row[]): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const r of rows) {
    const had = out.get(labelOf(r));
    if (!had || r.startedAt > had.startedAt) out.set(labelOf(r), r);
  }
  return out;
}

export function siblings(rows: Row[], r: Row): string[] {
  return rows.filter((x) => labelOf(x) === labelOf(r)).sort((a, b) => a.startedAt - b.startedAt).map((x) => x.id);
}

export const PENDING_MS = 90_000;

export function pendingOf(state: State, r: Row): Pending | null {
  const p = state.pending[labelOf(r)];
  return p && state.now - p.since < PENDING_MS ? p : null;
}

export function visible(state: State): Row[] {
  const top = newest(state.rows);
  const rows =
    state.filter === 'all'
      ? state.rows
      : state.rows.filter(
          (r) =>
            top.get(labelOf(r)) === r &&
            (isLive(r) || needsYou(r) || phaseOf(r) === 'ci-failing' || tidyOf(r, state.now) !== null || pendingOf(state, r) !== null || state.now - r.startedAt < DAY)
        );
  return [...rows].sort((a, b) => rankOf(a) - rankOf(b) || b.startedAt - a.startedAt);
}

export function selected(state: State): Row | null {
  const rows = visible(state);
  return rows.find((r) => r.id === state.selId) ?? rows[0] ?? null;
}

function move(state: State, by: number | 'home' | 'end'): State {
  const rows = visible(state);
  if (rows.length === 0) return state;
  const at = Math.max(0, rows.findIndex((r) => r.id === selected(state)?.id));
  const next =
    by === 'home' ? 0 : by === 'end' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, at + by));
  return { ...state, selId: rows[next].id };
}

function say(state: State, text: string, tone: Tone = 'info'): State {
  return { ...state, message: { text, tone } };
}

function toggleMark(state: State, row: Row): State {
  const marks = state.marks.includes(row.id) ? state.marks.filter((m) => m !== row.id) : [...state.marks, row.id];
  return { ...state, marks };
}

function markWhere(state: State, test: (r: Row) => boolean, empty: string): State {
  const ids = visible(state).filter(test).map((r) => r.id);
  if (ids.length === 0) return say(state, empty);
  const all = ids.every((id) => state.marks.includes(id));
  const marks = all ? state.marks.filter((m) => !ids.includes(m)) : [...state.marks, ...ids.filter((id) => !state.marks.includes(id))];
  return say({ ...state, marks }, all ? `Unticked ${ids.length}.` : `Ticked ${ids.length}.`);
}

export function targets(state: State): Row[] {
  if (state.marks.length) return state.marks.map((id) => state.rows.find((r) => r.id === id)).filter((r): r is Row => Boolean(r));
  const row = selected(state);
  return row ? [row] : [];
}

type Plan = { ok: true; effect: Effect } | { ok: false; why: string };

export interface CommandSpec {
  verb: string;
  doing: string;
  plan: (r: Row, state: State) => Plan;
}

function workerFree(r: Row): string | null {
  return r.state === 'working' ? 'still working' : null;
}

function openPr(r: Row): string | null {
  if (!r.pr) return 'no PR';
  if (r.pr.state !== 'OPEN') return `PR ${r.pr.state.toLowerCase()}`;
  return null;
}

const END = ' Begin your last message with the tinker-status line and end it with the TINKER line, as the worker contract says.';

export const PREPARE_SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'prepare', 'SKILL.md');

export function preparePrompt(r: Row, settings: Settings, review = process.env.TINKER_REVIEW, skill = PREPARE_SKILL): string {
  const flags = [settings.draft ? '--draft' : '', settings.autoMerge ? '--auto-merge' : '', review ? `--review "${review}"` : '']
    .filter(Boolean)
    .join(' ');
  const where = r.pr ? ` for PR #${r.pr.number} on branch ${r.pr.branch}` : '';
  return `Tinker command: prepare${where}. Read ${skill} and follow it${flags ? ` with ${flags}` : ' with no flags'}.${END}`;
}

export function fixCiPrompt(r: Row): string {
  const p = r.pr!;
  return (
    `Tinker command: fix CI. PR #${p.number} (branch ${p.branch}) has failing checks. Work on that branch in its ` +
    `worktree. Read the failing checks and their logs with gh and classify each as the contract's CI stage says: ` +
    `fix what this branch broke (run the checks the repo's CLAUDE.md names, commit and push), re-run a flaky ` +
    `or stale gate once, and leave a human-only gate. A check that fails the same way on ${p.base} is not this ` +
    `branch's: note it on the PR and leave it. Watch CI again after each push or re-run, at most three attempts ` +
    `in total. Do not change the PR's draft state and do not merge it.${END}`
  );
}

export function updatePrompt(r: Row): string {
  const p = r.pr!;
  return (
    `Tinker command: update. Bring origin/${p.base} into PR #${p.number}'s branch ${p.branch} by merging; never ` +
    `rebase or force-push. Resolve a conflict yourself only when it is mechanical and both sides' intent is ` +
    `clear; otherwise abort the merge and park with the conflicted paths. Run the checks the repo's CLAUDE.md ` +
    `names against the merged tree, then push.${END}`
  );
}

export function nudgePrompt(r: Row): string {
  const where = r.pr ? ` on PR #${r.pr.number} (branch ${r.pr.branch})` : '';
  return (
    `Tinker command: nudge. You look stuck${where}. If a command or tool call is hanging, abandon it and try ` +
    `another way. Say in one line where the work is and what is left, then carry on to the end of the worker ` +
    `contract: pushed, self-reviewed, CI watched. If you are waiting on something only a person can give, park ` +
    `and say exactly what you need.${END}`
  );
}

export function relaunchArgs(r: Row): string | null {
  if (r.key) return r.key;
  const gh = /^GH-(\d+)$/.exec(r.label);
  return gh ? `#${gh[1]}` : null;
}

function resume(r: Row, prompt: string, stopFirst = r.state === 'blocked'): Effect {
  return { type: 'resume', id: r.id, sessionId: r.sessionId, cwd: r.cwd, name: r.name, label: r.key ?? r.label, prompt, stopFirst };
}

export const COMMANDS: Record<string, CommandSpec> = {
  nudge: {
    verb: 'Nudge',
    doing: 'nudging',
    plan: (r) => {
      const why = r.pr && r.pr.state !== 'OPEN' ? `PR ${r.pr.state.toLowerCase()}` : null;
      return why ? { ok: false, why } : { ok: true, effect: resume(r, nudgePrompt(r), isLive(r)) };
    },
  },
  prepare: {
    verb: 'Prepare',
    doing: 'preparing',
    plan: (r, s) => {
      const why = workerFree(r) ?? (r.pr && r.pr.state !== 'OPEN' ? `PR ${r.pr.state.toLowerCase()}` : null);
      return why ? { ok: false, why } : { ok: true, effect: resume(r, preparePrompt(r, s.settings)) };
    },
  },
  'fix-ci': {
    verb: 'Fix CI on',
    doing: 'fixing CI',
    plan: (r) => {
      const why =
        workerFree(r) ?? openPr(r) ?? (r.pr!.ci !== 'fail' ? `CI ${r.pr!.ci}` : phaseOf(r) === 'awaiting-approval' ? 'awaiting approval' : null);
      return why ? { ok: false, why } : { ok: true, effect: resume(r, fixCiPrompt(r)) };
    },
  },
  update: {
    verb: 'Update',
    doing: 'updating',
    plan: (r) => {
      const why = workerFree(r) ?? openPr(r);
      return why ? { ok: false, why } : { ok: true, effect: resume(r, updatePrompt(r)) };
    },
  },
  cleanup: {
    verb: 'Clean up',
    doing: 'tidying',
    plan: (r, s) => {
      const tidy = tidyOf(r, s.now);
      if (!tidy) return { ok: false, why: isLive(r) ? 'still running' : r.pr ? 'PR still open' : 'not stale yet' };
      if (s.rows.some((x) => labelOf(x) === labelOf(r) && isLive(x) && !landed(x))) return { ok: false, why: 'another session for it is running' };
      return { ok: true, effect: cleanupEffect(s, r, tidy) };
    },
  },
  relaunch: {
    verb: 'Relaunch',
    doing: 'relaunching',
    plan: (r) => {
      if (isLive(r)) return { ok: false, why: 'still running' };
      const args = relaunchArgs(r);
      return args ? { ok: true, effect: { type: 'launch', args } } : { ok: false, why: 'no issue key to relaunch from' };
    },
  },
};

function cleanupEffect(s: State, r: Row, tidy: Tidy): Effect {
  const ids = siblings(s.rows, r);
  const stop = ids.filter((id) => s.rows.find((x) => x.id === id)?.state === 'blocked');
  return {
    type: 'cleanup',
    id: r.id,
    ids,
    ...(stop.length ? { stop } : {}),
    cwd: r.cwd,
    label: labelOf(r),
    branch: tidy === 'merged' ? r.pr!.branch : null,
  };
}

function automergeSpec(on: boolean): CommandSpec {
  return {
    verb: on ? 'Arm auto-merge on' : 'Disarm auto-merge on',
    doing: on ? 'arming auto-merge' : 'disarming auto-merge',
    plan: (r) => {
      const why = openPr(r) ?? (r.pr!.autoMerge === on ? (on ? 'already armed' : 'not armed') : null);
      return why ? { ok: false, why } : { ok: true, effect: { type: 'automerge', cwd: r.cwd, label: labelOf(r), number: r.pr!.number, on } };
    },
  };
}

/** How many of the targets a menu item would act on, and why the first skipped one would be skipped. */
export function fit(state: State, spec: CommandSpec): { ok: number; of: number; why: string | null } {
  const rows = targets(state);
  const plans = rows.map((r) => spec.plan(r, state));
  const miss = plans.find((p) => !p.ok);
  return { ok: plans.filter((p) => p.ok).length, of: rows.length, why: miss && !miss.ok ? miss.why : null };
}

export function apply(state: State, spec: CommandSpec): Step {
  const rows = targets(state);
  if (rows.length === 0) return { state: say(state, 'Nothing selected.', 'error'), effects: [] };
  const effects: Effect[] = [];
  const names: string[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const plan = spec.plan(r, state);
    const name = r.key ?? r.label;
    if (plan.ok) {
      effects.push(plan.effect);
      names.push(name);
    } else skipped.push(`${name} ${plan.why}`);
  }
  const note = skipped.length ? ` (${skipped.length} skipped: ${skipped.join(', ')})` : '';
  if (effects.length === 0) return { state: say(state, `Nothing to do${note}`, 'error'), effects: [] };
  return start(state, effects, { labels: names, verb: spec.doing }, `${spec.verb} ${names.join(', ')}${note}`);
}

function start(state: State, effects: Effect[], doing: { labels: string[]; verb: string }, text: string): Step {
  const pending = { ...state.pending };
  const waitFor = effects.some((e) => e.type === 'resume' || e.type === 'launch') ? 'session' : 'done';
  for (const label of doing.labels) pending[label] = { verb: doing.verb, since: state.now, waitFor };
  return { state: say({ ...state, marks: [], pending }, `${text}…`), effects };
}

function toggle(state: State, key: keyof Settings, label: string): Step {
  const settings = { ...state.settings, [key]: !state.settings[key] };
  return {
    state: say({ ...state, settings }, `${label} ${settings[key] ? 'on' : 'off'}.`),
    effects: [{ type: 'settings', settings }],
  };
}

export function autoTidy(state: State): Step {
  if (!state.settings.autoTidy) return { state, effects: [] };
  const effects: Effect[] = [];
  const tidying = [...state.tidying];
  const pending = { ...state.pending };
  for (const r of newest(state.rows).values()) {
    if (tidying.includes(r.id) || tidyOf(r, state.now) !== 'merged') continue;
    if (state.rows.some((x) => labelOf(x) === labelOf(r) && isLive(x) && !landed(x))) continue;
    tidying.push(r.id);
    pending[labelOf(r)] = { verb: 'tidying', since: state.now, waitFor: 'done' };
    effects.push(cleanupEffect(state, r, 'merged'));
  }
  return { state: { ...state, tidying, pending }, effects };
}

function readySpec(undo: boolean): CommandSpec {
  return {
    verb: undo ? 'Move back to draft' : 'Mark ready',
    doing: undo ? 'moving to draft' : 'marking ready',
    plan: (r) => {
      const why = openPr(r) ?? (r.pr!.draft !== undo ? null : undo ? 'already a draft' : 'already ready');
      return why ? { ok: false, why } : { ok: true, effect: { type: 'ready', cwd: r.cwd, label: labelOf(r), number: r.pr!.number, undo } };
    },
  };
}

export interface MenuItem {
  key: string;
  label: string;
  hint: string;
  spec: CommandSpec;
}

export const MENU: MenuItem[] = [
  { key: 'n', label: 'Nudge', hint: 'stuck? stop it if running, then tell it to report and carry on', spec: COMMANDS.nudge },
  { key: 'p', label: 'Prepare', hint: 'merge the base, run checks, review at the head, then mark ready (D keeps it a draft)', spec: COMMANDS.prepare },
  { key: 'r', label: 'Mark ready', hint: 'take the PR out of draft now: gh pr ready', spec: readySpec(false) },
  { key: 'd', label: 'Back to draft', hint: 'gh pr ready --undo', spec: readySpec(true) },
  { key: 'f', label: 'Fix CI', hint: 'read the failing checks, fix them, push', spec: COMMANDS['fix-ci'] },
  { key: 'u', label: 'Update', hint: 'merge the base branch in; parks on real conflicts', spec: COMMANDS.update },
  { key: 'a', label: 'Arm auto-merge', hint: 'GitHub merges it once required checks pass', spec: automergeSpec(true) },
  { key: 'A', label: 'Disarm auto-merge', hint: 'gh pr merge --disable-auto', spec: automergeSpec(false) },
  { key: 'c', label: 'Clean up', hint: 'remove the session and worktree, and the branch if merged', spec: COMMANDS.cleanup },
  { key: 'l', label: 'Relaunch', hint: 'a fresh worker for the same issue', spec: COMMANDS.relaunch },
];

function reduceMenu(state: State, key: Key): Step {
  const at = state.menu ?? 0;
  const closed: State = { ...state, menu: null };
  if (key.name === 'esc' || key.name === 'ctrl-c' || key.name === 'left' || (key.name === 'char' && (key.ch === 'm' || key.ch === ':' || key.ch === 'q')))
    return { state: closed, effects: [] };
  if (key.name === 'up' || (key.name === 'char' && key.ch === 'k')) return { state: { ...state, menu: (at + MENU.length - 1) % MENU.length }, effects: [] };
  if (key.name === 'down' || (key.name === 'char' && key.ch === 'j')) return { state: { ...state, menu: (at + 1) % MENU.length }, effects: [] };
  if (key.name === 'enter' || key.name === 'right') return apply(closed, MENU[at].spec);
  const hit = key.name === 'char' ? MENU.find((m) => m.key === key.ch) : undefined;
  if (hit) return apply(closed, hit.spec);
  return { state, effects: [] };
}

const NEXT_FIELD = { site: 'email', email: 'token' } as const;

function reduceJiraForm(state: State, key: Key): Step {
  const input = state.input as Extract<Input, { kind: 'jira' }>;
  if (key.name === 'esc' || key.name === 'ctrl-c') return { state: say({ ...state, input: null }, 'Jira not connected.'), effects: [] };
  const value = input[input.field];
  if (key.name === 'enter') {
    if (!value.trim()) return { state, effects: [] };
    if (input.field === 'token') {
      const { site, email, token } = input;
      return { state: say({ ...state, input: null }, `Connecting to ${site.trim()}…`), effects: [{ type: 'jira-connect', site: site.trim(), email: email.trim(), token: token.trim() }] };
    }
    return { state: { ...state, input: { ...input, field: NEXT_FIELD[input.field] } }, effects: [] };
  }
  if (key.name === 'backspace') return { state: { ...state, input: { ...input, [input.field]: value.slice(0, -1) } }, effects: [] };
  if (key.name === 'char' && key.ch) return { state: { ...state, input: { ...input, [input.field]: value + key.ch } }, effects: [] };
  return { state, effects: [] };
}

function reduceInput(state: State, key: Key): Step {
  if (state.input!.kind === 'jira') return reduceJiraForm(state, key);
  const input = state.input as Extract<Input, { kind: 'new' }>;
  if (key.name === 'esc' || key.name === 'ctrl-c') return { state: { ...state, input: null }, effects: [] };
  if (key.name === 'enter') {
    const args = input.text.trim();
    if (!args) return { state: { ...state, input: null }, effects: [] };
    return { state: say({ ...state, input: null }, `Launching ${args}…`), effects: [{ type: 'launch', args }] };
  }
  if (key.name === 'backspace') {
    return { state: { ...state, input: { ...input, text: input.text.slice(0, -1) } }, effects: [] };
  }
  if (key.name === 'char' && key.ch) return { state: { ...state, input: { ...input, text: input.text + key.ch } }, effects: [] };
  return { state, effects: [] };
}

function reduceConfirm(state: State, key: Key): Step {
  const confirm = state.confirm!;
  const cleared = { ...state, confirm: null };
  if (key.name === 'char' && (key.ch === 'y' || key.ch === 'Y')) return { state: cleared, effects: confirm.effects };
  return { state: say(cleared, 'Cancelled.'), effects: [] };
}

function reduceKey(state: State, key: Key): Step {
  if (state.input !== null) return reduceInput(state, key);
  if (state.confirm) return reduceConfirm(state, key);
  if (state.menu !== null) return reduceMenu(state, key);
  if (state.page === 'issues') return reduceIssuesKey(state, key);

  const row = selected(state);
  const ch = key.name === 'char' ? key.ch : undefined;
  const fresh = { ...state, message: null };

  if (key.name === 'ctrl-c' || ch === 'q') return { state, effects: [{ type: 'quit' }] };
  if (key.name === 'up' || key.name === 'wheel-up' || ch === 'k') return { state: move(fresh, -1), effects: [] };
  if (key.name === 'down' || key.name === 'wheel-down' || ch === 'j') return { state: move(fresh, 1), effects: [] };
  if (key.name === 'pageup') return { state: move(fresh, -10), effects: [] };
  if (key.name === 'pagedown') return { state: move(fresh, 10), effects: [] };
  if (key.name === 'home') return { state: move(fresh, 'home'), effects: [] };
  if (key.name === 'end') return { state: move(fresh, 'end'), effects: [] };
  if (key.name === 'tab' || ch === '2') return { state: { ...fresh, page: 'issues', view: 'list' }, effects: [{ type: 'load-issues' }] };
  if (ch === '1') return { state: { ...fresh, view: 'list' }, effects: [] };
  if (ch === 'f')
    return { state: { ...fresh, filter: state.filter === 'active' ? 'all' : 'active' }, effects: [] };
  if (ch === 'n') return { state: { ...fresh, input: { kind: 'new', text: '' } }, effects: [] };
  if (ch === 'm' || ch === ':') {
    if (targets(fresh).length === 0) return { state: say(fresh, 'Nothing selected.', 'error'), effects: [] };
    return { state: { ...fresh, menu: 0 }, effects: [] };
  }
  if (ch === 'r') return { state: say(fresh, 'Refreshing…'), effects: [{ type: 'refresh' }] };
  if (ch === 'u') return { state: say({ ...fresh, marks: [] }, 'Cleared the ticks.'), effects: [] };
  if (ch === 't') return { state: markWhere(fresh, (r) => tidyOf(r, state.now) !== null, 'Nothing to tidy.'), effects: [] };
  if (ch === 'D') return toggle(fresh, 'draft', 'Stop at draft');
  if (ch === 'M') return toggle(fresh, 'autoMerge', 'Auto-merge after prepare');
  if (ch === 'T') return toggle(fresh, 'autoTidy', 'Auto-tidy merged sessions');
  if (ch === 'p') return apply(fresh, COMMANDS.prepare);
  if (ch === 'c') return apply(fresh, COMMANDS.cleanup);

  if (state.view === 'detail' && (key.name === 'esc' || key.name === 'left' || key.name === 'backspace'))
    return { state: { ...fresh, view: 'list' }, effects: [] };

  if (!row) return { state: fresh, effects: [] };

  if (ch === ' ' && state.view === 'list') return { state: toggleMark(fresh, row), effects: [] };
  if (ch === '*' && state.view === 'list') {
    const group = groupOf(row, state.now);
    return { state: markWhere(fresh, (r) => groupOf(r, state.now) === group, 'Nothing in that group.'), effects: [] };
  }
  if (key.name === 'enter' || key.name === 'right')
    return state.view === 'list'
      ? { state: { ...fresh, view: 'detail', selId: row.id }, effects: [] }
      : { state: fresh, effects: [{ type: 'attach', id: row.id }] };
  if (ch === 'a') return { state: fresh, effects: [{ type: 'attach', id: row.id }] };
  if (ch === 'o' || ch === 'g') {
    if (!row.pr) return { state: say(fresh, `No PR for ${row.label} yet.`), effects: [] };
    return { state: fresh, effects: [{ type: 'open', url: row.pr.url }] };
  }
  if (ch === 'i') {
    if (!row.pr || row.pr.ci === 'none') return { state: say(fresh, `No CI for ${row.label} yet.`), effects: [] };
    return { state: fresh, effects: [{ type: 'open', url: row.pr.checksUrl }] };
  }
  if (ch === 'x') {
    if (!isLive(row)) return { state: say(fresh, `${row.label} is not running.`), effects: [] };
    return {
      state: { ...fresh, confirm: { text: `Stop ${row.label}? y to stop, any key to keep it.`, effects: [{ type: 'stop', id: row.id }] } },
      effects: [],
    };
  }
  return { state: fresh, effects: [] };
}

export function reduce(state: State, msg: Msg): Step {
  switch (msg.type) {
    case 'rows': {
      const top = newest(msg.rows);
      const follow = (id: string): string | null => {
        const r = msg.rows.find((x) => x.id === id) ?? state.rows.find((x) => x.id === id);
        return r ? (top.get(labelOf(r))?.id ?? null) : null;
      };
      const marks = [...new Set(state.marks.map(follow).filter((m): m is string => m !== null))];
      const pending: Record<string, Pending> = {};
      for (const [label, p] of Object.entries(state.pending)) {
        if (msg.now - p.since >= PENDING_MS) continue;
        const r = top.get(label);
        if (p.waitFor === 'session' && r && r.state === 'working') continue;
        if (p.waitFor === 'done' && !r) continue;
        pending[label] = p;
      }
      const ids = new Set(msg.rows.map((r) => r.id));
      const next: State = {
        ...state,
        rows: msg.rows,
        loaded: true,
        now: msg.now,
        marks,
        pending,
        selId: state.selId ? (follow(state.selId) ?? state.selId) : null,
        tidying: state.tidying.filter((m) => ids.has(m)),
      };
      return autoTidy({ ...next, selId: selected(next)?.id ?? null });
    }
    case 'resize':
      return { state: { ...state, width: msg.width, height: msg.height }, effects: [] };
    case 'machine':
      return { state: { ...state, machine: msg.machine, now: msg.now ?? state.now }, effects: [] };
    case 'account':
      return { state: { ...state, account: msg.account }, effects: [] };
    case 'issues': {
      const keys = new Set(msg.list.map((i) => i.url));
      const issues: IssuesState = {
        ...state.issues,
        list: msg.list,
        jira: msg.jira,
        github: msg.github,
        jiraSite: msg.jiraSite ?? state.issues.jiraSite,
        tickets: msg.tickets ?? state.issues.tickets,
        loadedAt: msg.now,
        marks: state.issues.marks.filter((k) => keys.has(k)),
        selKey: state.issues.selKey && keys.has(state.issues.selKey) ? state.issues.selKey : null,
      };
      return { state: { ...state, issues }, effects: [] };
    }
    case 'done': {
      const pending = { ...state.pending };
      delete pending[msg.label];
      return { state: { ...state, pending }, effects: [] };
    }
    case 'message':
      if (msg.page && msg.page !== state.page) return { state, effects: [] };
      return { state: say(state, msg.text, msg.tone), effects: [] };
    case 'key':
      return reduceKey(state, msg.key);
  }
}

export function shownIssues(state: State): Issue[] {
  return state.issues.list.filter((i) => matches(i, state.issues.filter)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function selectedIssue(state: State): Issue | null {
  const shown = shownIssues(state);
  return shown.find((i) => i.url === state.issues.selKey) ?? shown[0] ?? null;
}

function withIssues(state: State, patch: Partial<IssuesState>): State {
  return { ...state, issues: { ...state.issues, ...patch } };
}

function moveIssue(state: State, by: number): State {
  const shown = shownIssues(state);
  if (!shown.length) return state;
  const at = Math.max(0, shown.findIndex((i) => i.url === selectedIssue(state)?.url));
  return withIssues(state, { selKey: shown[Math.min(shown.length - 1, Math.max(0, at + by))].url });
}

function launchIssues(state: State): Step {
  const shown = shownIssues(state);
  const ticked = state.issues.marks.map((u) => state.issues.list.find((i) => i.url === u)).filter((i): i is Issue => Boolean(i));
  const sel = selectedIssue(state);
  const picks = ticked.length ? ticked : sel && shown.includes(sel) ? [sel] : [];
  if (!picks.length) return { state: say(state, 'Nothing selected.', 'error'), effects: [] };
  const running = (i: Issue) => {
    const r = sessionFor(i, state.rows);
    return r !== null && isLive(r);
  };
  const live = picks.filter(running).map((i) => i.key);
  const go = picks.filter((i) => !running(i));
  if (!go.length) return { state: say(state, `${live.join(', ')} already ha${live.length === 1 ? 's a running session' : 've running sessions'}; tab to see ${live.length === 1 ? 'it' : 'them'}.`), effects: [] };
  const keys = go.map((i) => i.key);
  const pending = { ...state.pending };
  for (const k of keys) pending[k] = { verb: 'launching', since: state.now, waitFor: 'session' };
  const note = live.length ? ` (skipped ${live.join(', ')}, it already has a running session)` : '';
  return {
    state: say(withIssues({ ...state, page: 'sessions', pending }, { marks: [] }), `Launching ${keys.join(', ')}${note}…`),
    effects: [{ type: 'launch-batch', batches: launchBatches(go) }],
  };
}

function reduceIssuesKey(state: State, key: Key): Step {
  const ch = key.name === 'char' ? key.ch : undefined;
  const fresh = { ...state, message: null };
  const is = state.issues;

  if (is.filtering) {
    if (key.name === 'esc') return { state: withIssues(fresh, { filtering: false, filter: '' }), effects: [] };
    if (key.name === 'enter') return { state: withIssues(fresh, { filtering: false }), effects: [] };
    if (key.name === 'backspace') return { state: withIssues(fresh, { filter: is.filter.slice(0, -1) }), effects: [] };
    if (ch) return { state: withIssues(fresh, { filter: is.filter + ch, selKey: null }), effects: [] };
    if (key.name !== 'up' && key.name !== 'down') return { state: fresh, effects: [] };
  }

  if (key.name === 'ctrl-c' || ch === 'q') return { state, effects: [{ type: 'quit' }] };
  if (key.name === 'tab' || key.name === 'esc' || ch === '1') return { state: { ...fresh, page: 'sessions' }, effects: [] };
  if (ch === '2') return { state: fresh, effects: [] };
  if (key.name === 'up' || key.name === 'wheel-up' || ch === 'k') return { state: moveIssue(fresh, -1), effects: [] };
  if (key.name === 'down' || key.name === 'wheel-down' || ch === 'j') return { state: moveIssue(fresh, 1), effects: [] };
  if (key.name === 'pageup') return { state: moveIssue(fresh, -10), effects: [] };
  if (key.name === 'pagedown') return { state: moveIssue(fresh, 10), effects: [] };
  if (ch === '/') return { state: withIssues(fresh, { filtering: true }), effects: [] };
  if (ch === 'r') return { state: say(fresh, 'Refreshing issues…'), effects: [{ type: 'load-issues' }] };
  if (ch === 'J')
    return { state: { ...fresh, input: { kind: 'jira', field: 'site', site: '', email: '', token: '' } }, effects: [{ type: 'open', url: TOKEN_PAGE }] };
  if (ch === 'G') {
    if (is.github.state === 'connected') return { state: say(fresh, `GitHub is connected as ${is.github.who}.`), effects: [] };
    return { state: say(fresh, 'Opening GitHub sign-in…'), effects: [{ type: 'gh-login' }] };
  }
  if (ch === '*') {
    const keys = shownIssues(state).map((i) => i.url);
    const all = keys.length > 0 && keys.every((k) => is.marks.includes(k));
    return { state: withIssues(fresh, { marks: all ? is.marks.filter((k) => !keys.includes(k)) : [...new Set([...is.marks, ...keys])] }), effects: [] };
  }
  if (key.name === 'enter') return launchIssues(fresh);

  const sel = selectedIssue(state);
  if (!sel) return { state: fresh, effects: [] };
  if (ch === ' ') {
    const marks = is.marks.includes(sel.url) ? is.marks.filter((u) => u !== sel.url) : [...is.marks, sel.url];
    return { state: withIssues(fresh, { marks, selKey: sel.url }), effects: [] };
  }
  if (ch === 'o') return { state: fresh, effects: [{ type: 'open', url: sel.url }] };
  return { state: fresh, effects: [] };
}

/** The ticket a session works on: its listed issue, else a Jira key linked on the connected site. */
export function ticketOf(r: Row, issues: IssuesState): { url: string | null; title: string | null } {
  const key = r.key ?? r.label;
  const hit = issues.list.find((i) => i.key === key) ?? issues.tickets.find((i) => i.key === key);
  if (hit) return { url: hit.url, title: hit.title };
  if (r.key && !key.startsWith('GH-') && issues.jiraSite) return { url: `${issues.jiraSite}/browse/${key}`, title: null };
  return { url: null, title: null };
}
