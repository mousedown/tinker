import { describe, expect, test } from 'bun:test';
import { segsWidth, stripAnsi } from '../tui/render/text';
import { initialState, reduce, type State } from '../tui/state';
import { VERSION } from '../tui/version';
import { screen } from '../tui/view';
import { NOW, row } from './fixtures';

const account = {
  account: { email: 'a@b.io', plan: 'Max 20x', dir: '/p/.claude-work2' },
  limits: { fiveHour: 3, sevenDay: 46, fiveHourResetAt: null, sevenDayResetAt: null, at: NOW },
};

function state(width = 150, over: Partial<State> = {}): State {
  let s = reduce(initialState(width, 30), { type: 'rows', rows: [row({ id: 'b', state: 'blocked' }), row({ id: 'w', key: 'ABC-2', label: 'ABC-2', name: '🐙 ABC-2' })], now: NOW }).state;
  s = reduce(s, { type: 'account', account }).state;
  return { ...s, ...over };
}
const lines = (s: State) => screen(s).map(stripAnsi);
const cells = (line: string) => segsWidth([[line, null]]);

describe('the header panel', () => {
  test('is a box the width of the terminal, the tabs and version in its top border', () => {
    const l = lines(state());
    expect(l[0]).toStartWith('╭─ 🐙 tinker ── 1 Sessions │ 2 Issues ');
    expect(l[0]).toEndWith(` v${VERSION} ─╮`);
    const bottom = l.findIndex((x) => x.startsWith('╰'));
    expect(bottom).toBe(4);
    expect(l[bottom]).toEndWith('╯');
    for (const x of l.slice(0, bottom + 1)) expect(cells(x)).toBe(150);
    for (const x of l.slice(1, bottom)) {
      expect(x).toStartWith('│ ');
      expect(x).toEndWith(' │');
    }
  });

  test('holds the status and toggles, who you are and the plan, then the machine', () => {
    const l = lines(state());
    expect(l[1]).toContain('◆ 1 need you');
    expect(l[1]).toContain('● 1 working');
    expect(l[1]).toMatch(/D draft ○ {2}M merge ○ {2}T tidy ○ │$/);
    expect(l[2]).toContain('◉ a@b.io · Max 20x · claude-work2');
    expect(l[2]).toContain('5h 3%');
    expect(l[2]).toContain('week 46%');
    expect(l[3]).toStartWith('│ ');
    expect(lines(state()).join('\n')).not.toContain('Little Tinker');
  });

  test('the Issues page puts the trackers where the toggles were', () => {
    const s = reduce(state(), { type: 'key', key: { name: 'char', ch: '2' } }).state;
    const l = lines(reduce(s, { type: 'issues', list: [], jira: { state: 'connected', who: 'Chris A' }, github: { state: 'disconnected', who: null }, now: NOW }).state);
    expect(l[0]).toContain('1 Sessions │ 2 Issues');
    expect(l[1]).toContain('Jira ● connected as Chris A');
    expect(l[1]).toContain('GitHub ○ not connected — G to connect');
    expect(l[1]).not.toContain('D draft');
  });

  test('the detail view shows where you are in the border', () => {
    const s = reduce(state(), { type: 'key', key: { name: 'enter' } }).state;
    expect(lines(s)[0]).toMatch(/1 Sessions │ 2 Issues › ABC-1/);
  });

  test('a narrow terminal keeps the box intact and drops the right-hand side first', () => {
    const l = lines(state(56));
    const bottom = l.findIndex((x) => x.startsWith('╰'));
    for (const x of l.slice(0, bottom + 1)) expect(cells(x)).toBe(56);
    expect(l[1]).toContain('◆ 1 need you');
    expect(l[1]).not.toContain('T tidy');
  });

  test('a newer release shows in the border', () => {
    expect(lines(state(150, { update: '9.9.9' }))[0]).toContain('↑ 9.9.9: tinker update');
  });
});
