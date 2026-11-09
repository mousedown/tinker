import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Row } from './data';
import type { MachineView } from './machine';
import type { Key } from './runtime/keys';
import { DEFAULTS, type Settings } from './settings';

export type Filter = 'active' | 'all';
export type View = 'list' | 'detail';
export type Tone = 'info' | 'error';
export type Tidy = 'merged' | 'closed' | 'stale';
export type Group = 'needs' | 'live' | 'tidy' | 'done';

export interface Input {
  kind: 'new';
  text: string;
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
  input: Input | null;
  confirm: Confirm | null;
  menu: number | null;
  marks: string[];
  settings: Settings;
  tidying: string[];
  pending: Record<string, Pending>;
  machine: MachineView | null;
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
  | { type: 'done'; label: string }
  | { type: 'message'; text: string; tone: Tone };

export type Effect =
  | { type: 'attach'; id: string }
  | { type: 'stop'; id: string }
  | { type: 'launch'; args: string }
  | { type: 'resume'; id: string; sessionId: string; cwd: string; name: string; label: string; prompt: string; stopFirst: boolean }
  | { type: 'cleanup'; id: string; ids: string[]; cwd: string; label: string; branch: string | null }
  | { type: 'automerge'; cwd: string; label: string; number: number; on: boolean }
  | { type: 'ready'; cwd: string; label: string; number: number; undo: boolean }
  | { type: 'settings'; settings: Settings }
  | { type: 'open'; url: string }
  | { type: 'refresh' }
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
    input: null,
    confirm: null,
    menu: null,
    marks: [],
    settings: { ...settings },
    tidying: [],
    pending: {},
    machine: null,
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

export function needsYou(r: Row): boolean {
  return r.state === 'blocked' || r.verdict?.kind === 'PARKED';
}

export function isLive(r: Row): boolean {
  return r.state === 'working' || r.state === 'blocked';
}

export function tidyOf(r: Row, now: number): Tidy | null {
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
            (isLive(r) || needsYou(r) || tidyOf(r, state.now) !== null || pendingOf(state, r) !== null || state.now - r.startedAt < DAY)
        );
  return [...rows].sort((a, b) => {
    const ra = needsYou(a) ? 0 : (RANK[a.state] ?? 5);
    const rb = needsYou(b) ? 0 : (RANK[b.state] ?? 5);
    return ra - rb || b.startedAt - a.startedAt;
  });
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

const END = ' End with the TINKER line, as the worker contract says.';

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
    `worktree. Read the failing checks and their logs with gh, fix what this branch broke, run the checks the ` +
    `repo's CLAUDE.md names, commit and push. A check that fails the same way on ${p.base} is not this branch's: ` +
    `note it on the PR and leave it. At most two re-runs of the same red check. Do not change the PR's draft ` +
    `state and do not merge it.${END}`
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

export function relaunchArgs(r: Row): string | null {
  if (r.key) return r.key;
  const gh = /^GH-(\d+)$/.exec(r.label);
  return gh ? `#${gh[1]}` : null;
}

function resume(r: Row, prompt: string): Effect {
  return { type: 'resume', id: r.id, sessionId: r.sessionId, cwd: r.cwd, name: r.name, label: r.key ?? r.label, prompt, stopFirst: r.state === 'blocked' };
}

export const COMMANDS: Record<string, CommandSpec> = {
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
      const why = workerFree(r) ?? openPr(r) ?? (r.pr!.ci === 'fail' ? null : `CI ${r.pr!.ci}`);
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
      if (s.rows.some((x) => labelOf(x) === labelOf(r) && isLive(x))) return { ok: false, why: 'another session for it is running' };
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
  return { type: 'cleanup', id: r.id, ids: siblings(s.rows, r), cwd: r.cwd, label: labelOf(r), branch: tidy === 'merged' ? r.pr!.branch : null };
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
    if (state.rows.some((x) => labelOf(x) === labelOf(r) && isLive(x))) continue;
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

function reduceInput(state: State, key: Key): Step {
  const input = state.input!;
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
  if (key.name === 'tab' || ch === 'f')
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
    case 'done': {
      const pending = { ...state.pending };
      delete pending[msg.label];
      return { state: { ...state, pending }, effects: [] };
    }
    case 'message':
      return { state: say(state, msg.text, msg.tone), effects: [] };
    case 'key':
      return reduceKey(state, msg.key);
  }
}
