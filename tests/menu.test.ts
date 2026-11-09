import { describe, expect, test } from 'bun:test';
import { checksUrlOf, countChecks } from '../tui/data';
import { inline, markdown } from '../tui/markdown';
import { stripAnsi } from '../tui/render/text';
import { DEFAULTS } from '../tui/settings';
import { STALE_MS, initialState, preparePrompt, reduce, relaunchArgs, tidyOf, type State } from '../tui/state';
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
    const asked = reduce(s, key('c'));
    expect(asked.effects).toEqual([]);
    expect(asked.state.confirm?.text).toContain('Clean up');
    const done = reduce(asked.state, key('y'));
    expect(done.effects).toEqual([
      { type: 'cleanup', id: 'm1', cwd: '/repo', label: 'ABC-200', branch: 'fix/ABC-200' },
      { type: 'cleanup', id: 'c1', cwd: '/repo', label: 'ABC-201', branch: null },
      { type: 'cleanup', id: 's1', cwd: '/repo', label: 'ABC-202', branch: null },
    ].sort((a, b) => s.marks.indexOf(a.id) - s.marks.indexOf(b.id)));
    expect(done.state.marks).toEqual([]);
  });

  test('auto-tidy cleans merged sessions once, and leaves closed and stale ones for you', () => {
    const on = { ...DEFAULTS, autoTidy: true };
    const first = reduce(initialState(140, 40, on), { type: 'rows', rows: [merged, closed, stale], now: NOW });
    expect(first.effects).toEqual([{ type: 'cleanup', id: 'm1', cwd: '/repo', label: 'ABC-200', branch: 'fix/ABC-200' }]);
    const again = reduce(first.state, { type: 'rows', rows: [merged, closed, stale], now: NOW });
    expect(again.effects).toEqual([]);
    expect(reduce(initialState(140, 40), { type: 'rows', rows: [merged], now: NOW }).effects).toEqual([]);
  });
});

describe('menu', () => {
  test('space ticks and moves down, * ticks the group, u clears', () => {
    let s = loaded();
    s = press(s, ' ');
    expect(s.marks).toEqual(['p1']);
    expect(s.selId).toBe('b1');
    s = press(s, 'u');
    expect(s.marks).toEqual([]);
    s = { ...s, selId: 'b1' };
    s = press(s, '*');
    expect(s.marks.sort()).toEqual(['b1', 'p1']);
  });

  test('prepare resumes the ticked sessions and skips the running ones, naming them', () => {
    const s = { ...loaded(), marks: ['d1', 'w1'] };
    const asked = reduce(s, key('p'));
    expect(asked.state.confirm?.text).toContain('Prepare ABC-103?');
    expect(asked.state.confirm?.text).toContain('ABC-101 still running');
    const done = reduce(asked.state, key('y'));
    expect(done.effects).toHaveLength(1);
    expect(done.effects[0]).toMatchObject({ type: 'resume', id: 'd1', cwd: '/repo' });
  });

  test('prepare carries the sticky toggles as flags', () => {
    const d1 = ROWS.find((r) => r.id === 'd1')!;
    expect(preparePrompt(d1, DEFAULTS, undefined)).toBe('/tinker:prepare for PR #2571 on branch fix/ABC-103');
    expect(preparePrompt(d1, { draft: true, autoMerge: true, autoTidy: false }, '/pullbot --fix')).toBe(
      '/tinker:prepare --draft --auto-merge --review "/pullbot --fix" for PR #2571 on branch fix/ABC-103'
    );
  });

  test('D, M and T flip the toggles and persist them', () => {
    const step = reduce(loaded(), key('D'));
    expect(step.state.settings.draft).toBe(true);
    expect(step.effects).toEqual([{ type: 'settings', settings: { draft: true, autoMerge: false, autoTidy: false } }]);
    expect(press(loaded(), 'M', 'T').settings).toEqual({ draft: false, autoMerge: true, autoTidy: true });
  });

  test('the : line runs commands: fix-ci needs a red PR, automerge needs on or off', () => {
    const run = (s: State, line: string) => {
      let st = press(s, ':', ...line.split(''));
      return reduce(st, { type: 'key', key: { name: 'enter' } });
    };
    const base = { ...loaded(), marks: ['d1', 'f1'] };
    const fix = run(base, 'fix-ci');
    expect(fix.state.confirm?.text).toContain('Fix CI on ABC-105?');
    expect(fix.state.confirm?.text).toContain('ABC-103 CI pass');
    expect(run(base, 'automerge').state.message?.tone).toBe('error');
    const arm = reduce(run(base, 'automerge on').state, key('y'));
    expect(arm.effects).toEqual([
      { type: 'automerge', cwd: '/repo', number: 2571, on: true },
      { type: 'automerge', cwd: '/repo', number: 2580, on: true },
    ]);
    expect(run(base, 'nope').state.message?.text).toContain('Unknown command');
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
