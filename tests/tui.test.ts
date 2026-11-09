import { describe, expect, test } from 'bun:test';
import { assistantTexts, issueKey, labelOf, prFor, verdictOf, type Pr } from '../tui/data';
import { initialState, reduce, selected, visible, type State } from '../tui/state';
import { NOW, ROWS, row } from './fixtures';

const pr = (over: Partial<Pr>): Pr => ({
  number: 1,
  title: 't',
  branch: 'b',
  url: 'u',
  state: 'OPEN',
  draft: true,
  ci: 'none',
  ...over,
});

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
    expect(step.state.confirmStop).toBeNull();
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
    expect(step.state.input).toBe('q');
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
