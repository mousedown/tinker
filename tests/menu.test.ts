import { describe, expect, test } from 'bun:test';
import { activityOf, checksUrlOf, countChecks, describeTool } from '../tui/data';
import { inline, markdown } from '../tui/markdown';
import { stripAnsi } from '../tui/render/text';
import { DEFAULTS } from '../tui/settings';
import { existsSync } from 'fs';
import { PREPARE_SKILL, STALE_MS, initialState, preparePrompt, reduce, relaunchArgs, tidyOf, visible, type State } from '../tui/state';
import { ciBar, screen } from '../tui/view';
import { NOW, ROWS, pr, row } from './fixtures';

const key = (ch: string) => ({ type: 'key' as const, key: { name: 'char' as const, ch } });
const loaded = (rows = ROWS, settings = DEFAULTS): State =>
  reduce(initialState(140, 40, settings), { type: 'rows', rows, now: NOW }).state;
const press = (s: State, ...chs: string[]) => chs.reduce((st, ch) => reduce(st, key(ch)).state, s);

const merged = row({ id: 'm1', key: 'ABC-200', label: 'ABC-200', state: 'done', pr: pr({ number: 3000, branch: 'fix/ABC-200', state: 'MERGED' }) });
const closed = row({ id: 'c1', key: 'ABC-201', label: 'ABC-201', state: 'done', pr: pr({ number: 3001, state: 'CLOSED' }) });
const stale = row({ id: 's1', key: 'ABC-202', label: 'ABC-202', state: 'done', startedAt: NOW - STALE_MS - 1 });

describe('tidy', () => {
  test('merged, closed and week-old PR-less sessions are tidyable; live ones never', () => {
    expect(tidyOf(merged, NOW)).toBe('merged');
    expect(tidyOf(closed, NOW)).toBe('closed');
    expect(tidyOf(stale, NOW)).toBe('stale');
    expect(tidyOf({ ...merged, state: 'working' }, NOW)).toBeNull();
    expect(tidyOf(ROWS.find((r) => r.id === 'd1')!, NOW)).toBeNull();
  });

  test('t ticks every tidyable row and c asks before cleaning; only a merged PR loses its branch', () => {
    const s = press(loaded([...ROWS, merged, closed, stale]), 't');
    expect(s.marks.sort()).toEqual(['c1', 'm1', 's1']);
    const done = reduce(s, key('c'));
    expect(done.state.message?.text).toContain('Clean up');
    expect(done.effects).toEqual([
      { type: 'cleanup', id: 'm1', ids: ['m1'], cwd: '/repo', label: 'ABC-200', branch: 'fix/ABC-200' },
      { type: 'cleanup', id: 'c1', ids: ['c1'], cwd: '/repo', label: 'ABC-201', branch: null },
      { type: 'cleanup', id: 's1', ids: ['s1'], cwd: '/repo', label: 'ABC-202', branch: null },
    ].sort((a, b) => s.marks.indexOf(a.id) - s.marks.indexOf(b.id)));
    expect(Object.keys(done.state.pending).sort()).toEqual(['ABC-200', 'ABC-201', 'ABC-202']);
    expect(done.state.marks).toEqual([]);
  });

  test('auto-tidy cleans merged sessions once, and leaves closed and stale ones for you', () => {
    const on = { ...DEFAULTS, autoTidy: true };
    const first = reduce(initialState(140, 40, on), { type: 'rows', rows: [merged, closed, stale], now: NOW });
    expect(first.effects).toEqual([{ type: 'cleanup', id: 'm1', ids: ['m1'], cwd: '/repo', label: 'ABC-200', branch: 'fix/ABC-200' }]);
    const again = reduce(first.state, { type: 'rows', rows: [merged, closed, stale], now: NOW });
    expect(again.effects).toEqual([]);
    expect(reduce(initialState(140, 40), { type: 'rows', rows: [merged], now: NOW }).effects).toEqual([]);
  });
});

describe('menu', () => {
  test('space ticks in place, * ticks the group, u clears', () => {
    let s = loaded();
    s = press(s, ' ');
    expect(s.marks).toEqual(['p1']);
    expect(s.selId).toBe('p1');
    s = press(s, ' ');
    expect(s.marks).toEqual([]);
    s = press(s, 'u');
    expect(s.marks).toEqual([]);
    s = { ...s, selId: 'b1' };
    s = press(s, '*');
    expect(s.marks.sort()).toEqual(['b1', 'p1']);
  });

  test('prepare resumes the ticked sessions and skips the running ones, naming them', () => {
    const s = { ...loaded(), marks: ['d1', 'w1'] };
    const done = reduce(s, key('p'));
    expect(done.state.confirm).toBeNull();
    expect(done.state.message?.text).toContain('Prepare ABC-103 (1 skipped: ABC-101 still working)');
    expect(done.effects).toHaveLength(1);
    expect(done.effects[0]).toMatchObject({ type: 'resume', id: 'd1', cwd: '/repo' });
  });

  test('prepare carries the sticky toggles as flags', () => {
    const d1 = ROWS.find((r) => r.id === 'd1')!;
    expect(preparePrompt(d1, DEFAULTS, undefined, '/t/SKILL.md')).toStartWith(
      'Tinker command: prepare for PR #2571 on branch fix/ABC-103. Read /t/SKILL.md and follow it with no flags.'
    );
    expect(preparePrompt(d1, { draft: true, autoMerge: true, autoTidy: false }, '/pullbot --fix', '/t/SKILL.md')).toContain(
      'follow it with --draft --auto-merge --review "/pullbot --fix".'
    );
    expect(PREPARE_SKILL).toEndWith('skills/prepare/SKILL.md');
    expect(existsSync(PREPARE_SKILL)).toBe(true);
  });

  test('D, M and T flip the toggles and persist them', () => {
    const step = reduce(loaded(), key('D'));
    expect(step.state.settings.draft).toBe(true);
    expect(step.effects).toEqual([{ type: 'settings', settings: { draft: true, autoMerge: false, autoTidy: false } }]);
    expect(press(loaded(), 'M', 'T').settings).toEqual({ draft: false, autoMerge: true, autoTidy: true });
  });

  test('m opens the menu; a letter or enter runs an item on the ticked rows', () => {
    const base = { ...loaded(), marks: ['d1', 'f1'] };
    const open = reduce(base, key('m')).state;
    expect(open.menu).toBe(0);
    const fix = reduce(open, key('f'));
    expect(fix.state.menu).toBeNull();
    expect(fix.state.message?.text).toContain('Fix CI on ABC-105');
    expect(fix.state.message?.text).toContain('ABC-103 CI pass');
    expect(fix.effects).toHaveLength(1);
    const down = reduce(open, { type: 'key', key: { name: 'down' } }).state;
    const ready = reduce(down, { type: 'key', key: { name: 'enter' } });
    expect(ready.state.message?.text).toContain('Mark ready ABC-103, ABC-105');
    expect(ready.effects).toEqual([
      { type: 'ready', cwd: '/repo', label: 'ABC-103', number: 2571, undo: false },
      { type: 'ready', cwd: '/repo', label: 'ABC-105', number: 2580, undo: false },
    ]);
    const arm = reduce(open, key('a'));
    expect(arm.effects).toEqual([
      { type: 'automerge', cwd: '/repo', label: 'ABC-103', number: 2571, on: true },
      { type: 'automerge', cwd: '/repo', label: 'ABC-105', number: 2580, on: true },
    ]);
    expect(reduce(open, { type: 'key', key: { name: 'esc' } }).state.menu).toBeNull();
  });

  test('back to draft refuses a PR that is already a draft', () => {
    const s = { ...loaded(), selId: 'd1' };
    const step = reduce(reduce(s, key('m')).state, key('d'));
    expect(step.state.message?.text).toContain('already a draft');
  });

  test('a resumed session replaces its old row, keeps the cursor, and shows progress until it is working', () => {
    const old = ROWS.find((r) => r.id === 'd1')!;
    let s = { ...loaded(), selId: 'd1' };
    s = reduce(s, key('p')).state;
    expect(s.pending['ABC-103']).toMatchObject({ verb: 'preparing', waitFor: 'session' });
    expect(stripAnsi(screen(s).join('\n'))).toContain('preparing…');
    const fresh = row({ ...old, id: 'd2', sessionId: 'd2-x', state: 'working', startedAt: NOW + 1000 });
    s = reduce(s, { type: 'rows', rows: [...ROWS, fresh], now: NOW + 2000 }).state;
    expect(s.selId).toBe('d2');
    expect(s.pending['ABC-103']).toBeUndefined();
    expect(visible(s).filter((r) => r.key === 'ABC-103').map((r) => r.id)).toEqual(['d2']);
  });

  test('relaunch works from a key or a GitHub issue, not a description', () => {
    expect(relaunchArgs(row({ key: 'ABC-9' }))).toBe('ABC-9');
    expect(relaunchArgs(row({ key: null, label: 'GH-42' }))).toBe('#42');
    expect(relaunchArgs(row({ key: null, label: 'the export button' }))).toBeNull();
  });

  test('i opens the CI link', () => {
    const s = { ...loaded(), selId: 'f1' };
    expect(reduce(s, key('i')).effects).toEqual([{ type: 'open', url: 'https://ci/run/7' }]);
  });
});

describe('CI', () => {
  test('counts and links to the first failing check', () => {
    const checks = [
      { conclusion: 'SUCCESS' },
      { conclusion: 'FAILURE', detailsUrl: 'https://ci/fail' },
      { status: 'IN_PROGRESS' },
    ];
    expect(countChecks(checks)).toEqual({ pass: 1, fail: 1, pending: 1 });
    expect(checksUrlOf('https://gh/pull/1', checks)).toBe('https://ci/fail');
    expect(checksUrlOf('https://gh/pull/1', [{ conclusion: 'SUCCESS' }])).toBe('https://gh/pull/1/checks');
  });

  test('the bar always shows a failure, and fills its width', () => {
    expect(ciBar(99, 1, 0)).toEqual([1, 0, 5]);
    expect(ciBar(0, 0, 4)).toEqual([0, 6, 0]);
    expect(ciBar(3, 3, 0)).toEqual([3, 0, 3]);
    expect(ciBar(0, 0, 0)).toEqual([0, 0, 0]);
  });

  test('the list shows the bar, the toggles and the tick', () => {
    const s = { ...loaded(), marks: ['f1'] };
    const text = stripAnsi(screen(s).join('\n'));
    expect(text).toContain('■■■■■■ ✕2');
    expect(text).toContain('D stop at draft ○');
    expect(text).toContain('☑');
  });
});

describe('markdown', () => {
  test('inline bold, code and links', () => {
    expect(inline('a **b** `c` [d](https://x.y/z)').map((s) => s[0])).toEqual(['a ', 'b', ' ', 'c', ' ', 'd']);
    expect(inline('[d](https://x.y/z)')[0][2]).toBe('https://x.y/z');
  });

  test('headings, bullets with hanging indent, fences and tables', () => {
    const lines = markdown('## Done\n- one two three four five six\n```\ncode\n```\n| a | b |\n|---|---|\n| 1 | 2 |', 14).map((l) =>
      l.map((s) => s[0]).join('')
    );
    expect(lines[0]).toBe('Done');
    expect(lines[1].startsWith('• one two')).toBe(true);
    expect(lines[2].startsWith('  ')).toBe(true);
    expect(lines).toContain('  code');
    expect(lines).toContain('a │ b');
    expect(lines).toContain('1 │ 2');
  });
});

describe('running status', () => {
  test('the latest tool call or message is the activity, with its time', () => {
    const at = '2026-11-09T15:53:29.238Z';
    const jsonl = [
      JSON.stringify({ type: 'assistant', timestamp: '2026-11-09T15:50:00Z', message: { content: [{ type: 'text', text: 'Merging main in.' }] } }),
      JSON.stringify({ type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'bun run check', description: 'Run lint and typecheck' } }] } }),
      JSON.stringify({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result' }] } }),
    ].join('\n');
    expect(activityOf(jsonl)).toEqual({ text: 'Run lint and typecheck', at: Date.parse(at) });
    expect(describeTool('Edit', { file_path: '/a/b/tutor-transfers.ts' })).toBe('Edit tutor-transfers.ts');
    expect(describeTool('mcp__github__create_pr', {})).toBe('create_pr');
  });

  test('a working row shows what it is doing and for how long', () => {
    const w = row({ id: 'w9', key: 'ABC-300', label: 'ABC-300', state: 'working', activity: { text: 'Run lint and typecheck', at: NOW - 40_000 } });
    const text = stripAnsi(screen(loaded([w])).join('\n'));
    expect(text).toContain('Run lint and typecheck  40s');
    expect(text).toMatch(/[◐◓◑◒] working/);
  });
});
