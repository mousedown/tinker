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
  kind: 'new' | 'command';
  text: string;
}

export interface Confirm {
  text: string;
  effects: Effect[];
}

export interface State {
  rows: Row[];
  selId: string | null;
  filter: Filter;
  view: View;
  input: Input | null;
  confirm: Confirm | null;
  marks: string[];
  settings: Settings;
  tidying: string[];
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
  | { type: 'machine'; machine: MachineView }
  | { type: 'message'; text: string; tone: Tone };

export type Effect =
  | { type: 'attach'; id: string }
  | { type: 'stop'; id: string }
  | { type: 'launch'; args: string }
  | { type: 'resume'; id: string; sessionId: string; cwd: string; name: string; label: string; prompt: string }
  | { type: 'cleanup'; id: string; cwd: string; label: string; branch: string | null }
  | { type: 'automerge'; cwd: string; number: number; on: boolean }
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
    marks: [],
    settings: { ...settings },
    tidying: [],
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

export function visible(state: State): Row[] {
  const rows =
    state.filter === 'all'
      ? state.rows
      : state.rows.filter((r) => isLive(r) || needsYou(r) || tidyOf(r, state.now) !== null || state.now - r.startedAt < DAY);
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

export const HELP =
  ':prepare · :fix-ci · :update · :cleanup · :relaunch · :automerge on|off · :tidy · :draft · :auto-merge · :auto-tidy · :q   ' +
  'keys: space tick · * tick group · t tick tidy · u clear · p prepare · c clean up · i CI · D draft · M auto-merge · T auto-tidy';

function toggleMark(state: State, row: Row): State {
  const marks = state.marks.includes(row.id) ? state.marks.filter((m) => m !== row.id) : [...state.marks, row.id];
  return move({ ...state, marks }, 1);
}

function markWhere(state: State, test: (r: Row) => boolean, empty: string): State {
  const ids = visible(state).filter(test).map((r) => r.id);
  if (ids.length === 0) return say(state, empty);
  const all = ids.every((id) => state.marks.includes(id));
  const marks = all ? state.marks.filter((m) => !ids.includes(m)) : [...state.marks, ...ids.filter((id) => !state.marks.includes(id))];
  return say({ ...state, marks }, all ? `Unticked ${ids.length}.` : `Ticked ${ids.length}.`);
}

function targets(state: State): Row[] {
  if (state.marks.length) return state.marks.map((id) => state.rows.find((r) => r.id === id)).filter((r): r is Row => Boolean(r));
  const row = selected(state);
  return row ? [row] : [];
}

type Plan = { ok: true; effect: Effect } | { ok: false; why: string };

export interface CommandSpec {
  verb: string;
  plan: (r: Row, state: State) => Plan;
}

function workerFree(r: Row): string | null {
  return isLive(r) ? 'still running' : null;
}

function openPr(r: Row): string | null {
  if (!r.pr) return 'no PR';
  if (r.pr.state !== 'OPEN') return `PR ${r.pr.state.toLowerCase()}`;
  return null;
}

const END = ' End with the TINKER line, as the worker contract says.';

export function preparePrompt(r: Row, settings: Settings, review = process.env.TINKER_REVIEW): string {
  const flags = [settings.draft ? '--draft' : '', settings.autoMerge ? '--auto-merge' : '', review ? `--review "${review}"` : '']
    .filter(Boolean)
    .join(' ');
  const where = r.pr ? ` for PR #${r.pr.number} on branch ${r.pr.branch}` : '';
  return `/tinker:prepare${flags ? ` ${flags}` : ''}${where}`;
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
  return { type: 'resume', id: r.id, sessionId: r.sessionId, cwd: r.cwd, name: r.name, label: r.key ?? r.label, prompt };
}

export const COMMANDS: Record<string, CommandSpec> = {
  prepare: {
    verb: 'Prepare',
    plan: (r, s) => {
      const why = workerFree(r) ?? (r.pr && r.pr.state !== 'OPEN' ? `PR ${r.pr.state.toLowerCase()}` : null);
      return why ? { ok: false, why } : { ok: true, effect: resume(r, preparePrompt(r, s.settings)) };
    },
  },
  'fix-ci': {
    verb: 'Fix CI on',
    plan: (r) => {
      const why = workerFree(r) ?? openPr(r) ?? (r.pr!.ci === 'fail' ? null : `CI ${r.pr!.ci}`);
      return why ? { ok: false, why } : { ok: true, effect: resume(r, fixCiPrompt(r)) };
    },
  },
  update: {
    verb: 'Update',
    plan: (r) => {
      const why = workerFree(r) ?? openPr(r);
      return why ? { ok: false, why } : { ok: true, effect: resume(r, updatePrompt(r)) };
    },
  },
  cleanup: {
    verb: 'Clean up',
    plan: (r, s) => {
      const tidy = tidyOf(r, s.now);
      if (!tidy) return { ok: false, why: isLive(r) ? 'still running' : r.pr ? 'PR still open' : 'not stale yet' };
      return {
        ok: true,
        effect: { type: 'cleanup', id: r.id, cwd: r.cwd, label: r.key ?? r.label, branch: tidy === 'merged' ? r.pr!.branch : null },
      };
    },
  },
  relaunch: {
    verb: 'Relaunch',
    plan: (r) => {
      if (isLive(r)) return { ok: false, why: 'still running' };
      const args = relaunchArgs(r);
      return args ? { ok: true, effect: { type: 'launch', args } } : { ok: false, why: 'no issue key to relaunch from' };
    },
  },
};

function automergeSpec(on: boolean): CommandSpec {
  return {
    verb: on ? 'Arm auto-merge on' : 'Disarm auto-merge on',
    plan: (r) => {
      const why = openPr(r) ?? (r.pr!.autoMerge === on ? (on ? 'already armed' : 'not armed') : null);
      return why ? { ok: false, why } : { ok: true, effect: { type: 'automerge', cwd: r.cwd, number: r.pr!.number, on } };
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
  return { state: { ...state, confirm: { text: `${spec.verb} ${names.join(', ')}?${note} y/n`, effects } }, effects: [] };
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
  for (const r of state.rows) {
    if (tidying.includes(r.id) || tidyOf(r, state.now) !== 'merged') continue;
    tidying.push(r.id);
    effects.push({ type: 'cleanup', id: r.id, cwd: r.cwd, label: r.key ?? r.label, branch: r.pr!.branch });
  }
  return { state: { ...state, tidying }, effects };
}

function command(state: State, line: string): Step {
  const [name = '', ...args] = line.trim().split(/\s+/);
  const closed: State = { ...state, input: null };
  if (!name) return { state: closed, effects: [] };
  if (name === 'q' || name === 'quit') return { state: closed, effects: [{ type: 'quit' }] };
  if (name === 'help') return { state: say(closed, HELP), effects: [] };
  if (name === 'draft') return toggle(closed, 'draft', 'Stop at draft');
  if (name === 'auto-merge') return toggle(closed, 'autoMerge', 'Auto-merge after prepare');
  if (name === 'auto-tidy') return toggle(closed, 'autoTidy', 'Auto-tidy merged sessions');
  if (name === 'automerge') {
    if (args[0] !== 'on' && args[0] !== 'off') return { state: say(closed, ':automerge needs on or off', 'error'), effects: [] };
    return apply(closed, automergeSpec(args[0] === 'on'));
  }
  if (name === 'tidy') return { state: markWhere(closed, (r) => tidyOf(r, state.now) !== null, 'Nothing to tidy.'), effects: [] };
  const spec = COMMANDS[name];
  if (spec) return apply(closed, spec);
  return { state: say(closed, `Unknown command :${name}. Try :help`, 'error'), effects: [] };
}

function reduceInput(state: State, key: Key): Step {
  const input = state.input!;
  if (key.name === 'esc' || key.name === 'ctrl-c') return { state: { ...state, input: null }, effects: [] };
  if (key.name === 'enter') {
    if (input.kind === 'command') return command(state, input.text);
    const args = input.text.trim();
    if (!args) return { state: { ...state, input: null }, effects: [] };
    return { state: say({ ...state, input: null }, `Launching ${args}…`), effects: [{ type: 'launch', args }] };
  }
  if (key.name === 'backspace') {
    if (!input.text && input.kind === 'command') return { state: { ...state, input: null }, effects: [] };
    return { state: { ...state, input: { ...input, text: input.text.slice(0, -1) } }, effects: [] };
  }
  if (key.name === 'char' && key.ch) return { state: { ...state, input: { ...input, text: input.text + key.ch } }, effects: [] };
  return { state, effects: [] };
}

function reduceConfirm(state: State, key: Key): Step {
  const confirm = state.confirm!;
  const cleared = { ...state, confirm: null };
  if (key.name === 'char' && (key.ch === 'y' || key.ch === 'Y')) {
    const marks = confirm.effects.some((e) => e.type === 'stop') ? state.marks : [];
    const n = confirm.effects.length;
    return { state: say({ ...cleared, marks }, n === 1 ? 'Working on it…' : `Working on ${n}…`), effects: confirm.effects };
  }
  return { state: say(cleared, 'Cancelled.'), effects: [] };
}

function reduceKey(state: State, key: Key): Step {
  if (state.input !== null) return reduceInput(state, key);
  if (state.confirm) return reduceConfirm(state, key);

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
  if (ch === ':') return { state: { ...fresh, input: { kind: 'command', text: '' } }, effects: [] };
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
      const ids = new Set(msg.rows.map((r) => r.id));
      const next: State = {
        ...state,
        rows: msg.rows,
        loaded: true,
        now: msg.now,
        marks: state.marks.filter((m) => ids.has(m)),
        tidying: state.tidying.filter((m) => ids.has(m)),
      };
      return autoTidy({ ...next, selId: selected(next)?.id ?? null });
    }
    case 'resize':
      return { state: { ...state, width: msg.width, height: msg.height }, effects: [] };
    case 'machine':
      return { state: { ...state, machine: msg.machine }, effects: [] };
    case 'message':
      return { state: say(state, msg.text, msg.tone), effects: [] };
    case 'key':
      return reduceKey(state, msg.key);
  }
}
