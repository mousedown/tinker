import { describe, expect, test } from 'bun:test';
import { assistantTexts, branchOf, issueKey, labelOf, prFor, verdictOf } from '../tui/data';
import { initialState, reduce, selected, visible, type State } from '../tui/state';
import { capacity, parsePeaks, parsePs, record, treeMb, type Peaks } from '../tui/capacity';
import { stripAnsi } from '../tui/render/text';
import { VERSION, newer } from '../tui/version';
import { versionTag } from '../tui/view';
import { NOW, ROWS, pr, row } from './fixtures';

describe('data', () => {
  test('issueKey reads the key from a session name', () => {
    expect(issueKey('🐙 ABC-123')).toBe('ABC-123');
    expect(issueKey('🐙 the export button')).toBeNull();
  });

  test('labelOf drops the tag', () => {
    expect(labelOf('🐙 GH-42')).toBe('GH-42');
  });

  test('verdictOf takes the last TINKER line, even inside backticks', () => {
    expect(verdictOf(['working on it', 'All green.\n`TINKER DONE https://github.com/o/r/pull/9 P0=0 P1=0 P2=1`'])).toEqual({
      kind: 'DONE',
      text: 'https://github.com/o/r/pull/9 P0=0 P1=0 P2=1',
    });
    expect(verdictOf(['TINKER DONE none P0=0 P1=0 P2=0', 'TINKER PARKED missing-decision pro-rata?'])).toEqual({
      kind: 'PARKED',
      text: 'missing-decision pro-rata?',
    });
    expect(verdictOf(['the contract says TINKER DONE at the end'])).toBeNull();
  });

  test('assistantTexts reads only assistant text parts', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'TINKER DONE fake' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }, { type: 'text', text: 'Fixed.' }] } }),
      '{"type":"assistant", truncated',
    ].join('\n');
    expect(assistantTexts(jsonl)).toEqual(['Fixed.']);
  });

  test('prFor prefers the PR the verdict names, then an open PR matching the key', () => {
    const prs = [pr({ number: 5, title: 'fix: ABC-1 old', state: 'CLOSED' }), pr({ number: 6, branch: 'fix/abc-1-thing' }), pr({ number: 9 })];
    expect(prFor('ABC-1', prs, { kind: 'DONE', text: 'https://github.com/o/r/pull/9 P0=0' })?.number).toBe(9);
    expect(prFor('ABC-1', prs, null)?.number).toBe(6);
    expect(prFor('ABC-2', prs, null)).toBeNull();
  });

  test('prFor finds a description worker\'s PR by its branch, before any verdict', () => {
    const prs = [pr({ number: 7, title: 'fix: tidy the footer', branch: 'fix/footer-gap' }), pr({ number: 8, branch: 'fix/abc-1-thing' })];
    expect(prFor(null, prs, null, 'fix/footer-gap')?.number).toBe(7);
    expect(prFor(null, prs, null, 'fix/nothing-yet')).toBeNull();
    expect(prFor('ABC-1', prs, null, 'fix/nothing-yet')?.number).toBe(8);
  });

  test('branchOf reads the last branch the worker was on, not a default one', () => {
    const line = (b: string) => JSON.stringify({ type: 'user', gitBranch: b });
    expect(branchOf([line('main'), line('fix/abc-1-thing')].join('\n'))).toBe('fix/abc-1-thing');
    expect(branchOf(line('main'))).toBeNull();
    expect(branchOf('')).toBeNull();
  });
});

describe('state', () => {
  const loaded = (): State => reduce(initialState(100, 30), { type: 'rows', rows: ROWS, now: NOW }).state;

  test('what needs you sorts first, and old finished sessions hide until "all"', () => {
    const s = loaded();
    expect(visible(s).map((r) => r.id)).toEqual(['p1', 'b1', 'w1', 'f1', 'd1']);
    const all = reduce(s, { type: 'key', key: { name: 'char', ch: 'f' } }).state;
    expect(visible(all).map((r) => r.id)).toContain('o1');
  });

  test('the selection follows its session when rows re-sort', () => {
    let s = loaded();
    s = reduce(s, { type: 'key', key: { name: 'down' } }).state;
    expect(selected(s)?.id).toBe('b1');
    const resorted = ROWS.map((r) => (r.id === 'b1' ? { ...r, state: 'working' } : r));
    s = reduce(s, { type: 'rows', rows: resorted, now: NOW }).state;
    expect(selected(s)?.id).toBe('b1');
  });

  test('stop asks first and only y stops', () => {
    let s = loaded();
    s = reduce(s, { type: 'key', key: { name: 'down' } }).state;
    const asked = reduce(s, { type: 'key', key: { name: 'char', ch: 'x' } });
    expect(asked.effects).toEqual([]);
    expect(reduce(asked.state, { type: 'key', key: { name: 'char', ch: 'n' } }).effects).toEqual([]);
    expect(reduce(asked.state, { type: 'key', key: { name: 'char', ch: 'y' } }).effects).toEqual([{ type: 'stop', id: 'b1' }]);
  });

  test('stop refuses a session that is not running', () => {
    const s = { ...loaded(), selId: 'd1' };
    const step = reduce(s, { type: 'key', key: { name: 'char', ch: 'x' } });
    expect(step.effects).toEqual([]);
    expect(step.state.confirm).toBeNull();
  });

  test('n opens the prompt and enter launches what was typed', () => {
    let s = reduce(loaded(), { type: 'key', key: { name: 'char', ch: 'n' } }).state;
    for (const ch of 'ABC-7 #8') s = reduce(s, { type: 'key', key: { name: 'char', ch } }).state;
    const step = reduce(s, { type: 'key', key: { name: 'enter' } });
    expect(step.effects).toEqual([{ type: 'launch', args: 'ABC-7 #8' }]);
    expect(step.state.input).toBeNull();
  });

  test('q in the prompt is text, not quit', () => {
    const s = reduce(loaded(), { type: 'key', key: { name: 'char', ch: 'n' } }).state;
    const step = reduce(s, { type: 'key', key: { name: 'char', ch: 'q' } });
    expect(step.effects).toEqual([]);
    expect(step.state.input).toEqual({ kind: 'new', text: 'q' });
  });

  test('enter opens detail, then attaches; o opens the PR', () => {
    const s = { ...loaded(), selId: 'd1' };
    const detail = reduce(s, { type: 'key', key: { name: 'enter' } }).state;
    expect(detail.view).toBe('detail');
    expect(reduce(detail, { type: 'key', key: { name: 'enter' } }).effects).toEqual([{ type: 'attach', id: 'd1' }]);
    expect(reduce(detail, { type: 'key', key: { name: 'char', ch: 'o' } }).effects).toEqual([
      { type: 'open', url: 'https://github.com/o/r/pull/2571' },
    ]);
  });

  test('a row with no PR says so instead of opening nothing', () => {
    const s = { ...loaded(), rows: [row({ id: 'z' })], selId: 'z' };
    const step = reduce(s, { type: 'key', key: { name: 'char', ch: 'o' } });
    expect(step.effects).toEqual([]);
    expect(step.state.message?.text).toContain('No PR');
  });
});

describe('version and room', () => {
  test('newer compares x.y.z numerically', () => {
    expect(newer('0.10.0', '0.9.9')).toBe(true);
    expect(newer('0.3.3', '0.3.3')).toBe(false);
    expect(newer('0.3.2', '0.3.10')).toBe(false);
    expect(newer('1.0.0-beta', '0.9.0')).toBe(true);
  });

  test('the header shows the version, and an update when one is out', () => {
    const base = initialState(140, 40);
    expect(stripAnsi(versionTag(base).map(([t]) => t).join(''))).toBe(`v${VERSION}`);
    expect(versionTag({ ...base, update: '9.9.9' }).map(([t]) => t).join('')).toContain('↑ 9.9.9: tinker update');
  });

  test('room is worked out the same way as the launcher works it out', () => {
    // Same machine and processes as tests/cli.test.ts.
    const procs = parsePs(['1 0 1000', '100 1 400000', '101 100 2700000', '200 1 300000', '999 1 9000000'].join('\n'));
    expect(Math.round(treeMb(procs, 100)!)).toBe(3027);
    expect(treeMb(procs, 4242)).toBeNull();

    const now = 1_000_000;
    const live = [{ id: 'a', pid: 100, state: 'working' }, { id: 'b', pid: 200, state: 'blocked' }];
    const fresh: Peaks = new Map();
    const using = record(fresh, live, procs, now);
    expect(Math.round(fresh.get('a')!.mb)).toBe(3027);
    expect(capacity(8192, 16384, fresh, live, using)).toMatchObject({ room: 2, heldBackMb: 0, learned: true });

    const before = parsePeaks(`a ${now - 60} 4096\nold ${now - 8 * 86400} 8000\n`, now);
    expect([...before.keys()]).toEqual(['a']);
    const u = record(before, live, procs, now);
    const c = capacity(8192, 16384, before, live, u)!;
    expect(c.perSessionMb).toBe(4096);
    expect(Math.floor(c.heldBackMb)).toBe(1068);
    expect(c.room).toBe(1);
  });

  test('no readings means 2 GB; small ones are floored at 1 GB; an override wins, and 0 turns it off', () => {
    expect(capacity(8192, 16384, new Map(), [], new Map())).toMatchObject({ room: 3, perSessionMb: 2048, learned: false });
    expect(capacity(8192, 16384, parsePeaks('x 1 300', 1), [], new Map())!.room).toBe(6);
    expect(capacity(8192, 16384, new Map(), [], new Map(), 4096)!.room).toBe(1);
    expect(capacity(8192, 16384, new Map(), [], new Map(), 0)).toBeNull();
  });
});
