import type { Row } from './data';
import type { Key } from './runtime/keys';

export type Filter = 'active' | 'all';
export type View = 'list' | 'detail';
export type Tone = 'info' | 'error';

export interface State {
  rows: Row[];
  selId: string | null;
  filter: Filter;
  view: View;
  input: string | null;
  confirmStop: string | null;
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
  | { type: 'message'; text: string; tone: Tone };

export type Effect =
  | { type: 'attach'; id: string }
  | { type: 'stop'; id: string }
  | { type: 'launch'; args: string }
  | { type: 'open'; url: string }
  | { type: 'refresh' }
  | { type: 'quit' };

export interface Step {
  state: State;
  effects: Effect[];
}

export function initialState(width: number, height: number): State {
  return {
    rows: [],
    selId: null,
    filter: 'active',
    view: 'list',
    input: null,
    confirmStop: null,
    message: null,
    loaded: false,
    width,
    height,
    now: Date.now(),
  };
}

const RANK: Record<string, number> = { blocked: 0, working: 1, failed: 2, stopped: 3, done: 4 };
const DAY = 24 * 60 * 60 * 1000;

export function needsYou(r: Row): boolean {
  return r.state === 'blocked' || r.verdict?.kind === 'PARKED';
}

export function isLive(r: Row): boolean {
  return r.state === 'working' || r.state === 'blocked';
}

export function visible(state: State): Row[] {
  const rows =
    state.filter === 'all'
      ? state.rows
      : state.rows.filter((r) => isLive(r) || needsYou(r) || state.now - r.startedAt < DAY);
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

function reduceInput(state: State, key: Key): Step {
  const input = state.input ?? '';
  if (key.name === 'esc' || key.name === 'ctrl-c') return { state: { ...state, input: null }, effects: [] };
  if (key.name === 'enter') {
    const args = input.trim();
    if (!args) return { state: { ...state, input: null }, effects: [] };
    return { state: say({ ...state, input: null }, `Launching ${args}…`), effects: [{ type: 'launch', args }] };
  }
  if (key.name === 'backspace') return { state: { ...state, input: input.slice(0, -1) }, effects: [] };
  if (key.name === 'char' && key.ch) return { state: { ...state, input: input + key.ch }, effects: [] };
  return { state, effects: [] };
}

function reduceKey(state: State, key: Key): Step {
  if (state.input !== null) return reduceInput(state, key);

  if (state.confirmStop) {
    const id = state.confirmStop;
    const cleared = { ...state, confirmStop: null };
    if (key.name === 'char' && key.ch === 'y') return { state: say(cleared, `Stopping ${id}…`), effects: [{ type: 'stop', id }] };
    return { state: say(cleared, 'Kept running.'), effects: [] };
  }

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
  if (ch === 'n') return { state: { ...fresh, input: '' }, effects: [] };
  if (ch === 'r') return { state: say(fresh, 'Refreshing…'), effects: [{ type: 'refresh' }] };

  if (state.view === 'detail' && (key.name === 'esc' || key.name === 'left' || key.name === 'backspace'))
    return { state: { ...fresh, view: 'list' }, effects: [] };

  if (!row) return { state: fresh, effects: [] };

  if (key.name === 'enter' || key.name === 'right')
    return state.view === 'list'
      ? { state: { ...fresh, view: 'detail', selId: row.id }, effects: [] }
      : { state: fresh, effects: [{ type: 'attach', id: row.id }] };
  if (ch === 'a') return { state: fresh, effects: [{ type: 'attach', id: row.id }] };
  if (ch === 'o' || ch === 'g') {
    if (!row.pr) return { state: say(fresh, `No PR for ${row.label} yet.`), effects: [] };
    return { state: fresh, effects: [{ type: 'open', url: row.pr.url }] };
  }
  if (ch === 'x') {
    if (!isLive(row)) return { state: say(fresh, `${row.label} is not running.`), effects: [] };
    return { state: say({ ...fresh, confirmStop: row.id }, `Stop ${row.label}? y to stop, any key to keep it.`), effects: [] };
  }
  return { state: fresh, effects: [] };
}

export function reduce(state: State, msg: Msg): Step {
  switch (msg.type) {
    case 'rows': {
      const next = { ...state, rows: msg.rows, loaded: true, now: msg.now };
      return { state: { ...next, selId: selected(next)?.id ?? null }, effects: [] };
    }
    case 'resize':
      return { state: { ...state, width: msg.width, height: msg.height }, effects: [] };
    case 'message':
      return { state: say(state, msg.text, msg.tone), effects: [] };
    case 'key':
      return reduceKey(state, msg.key);
  }
}
