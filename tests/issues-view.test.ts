import { describe, expect, test } from 'bun:test';
import type { Issue } from '../tui/issues';
import { stripAnsi } from '../tui/render/text';
import { initialState, reduce, type State, type Tracker } from '../tui/state';
import { screen } from '../tui/view';
import { NOW, row } from './fixtures';

const sv1: Issue = { source: 'jira', key: 'SV-1', title: 'Fix the payout email', status: 'To Do', url: 'u1', updatedAt: 3, repo: null };
const gh42: Issue = { source: 'github', key: 'GH-42', title: 'Export button does nothing', status: 'open', url: 'u2', updatedAt: 2, repo: '/r' };
const on = (who: string): Tracker => ({ state: 'connected', who });
const off: Tracker = { state: 'disconnected', who: null };

function page(list: Issue[], jira: Tracker, github: Tracker, rows = [row({ id: 'n', key: 'GH-42', label: 'GH-42', state: 'blocked' })]): State {
  let s = reduce(initialState(140, 30), { type: 'rows', rows, now: NOW }).state;
  s = reduce(s, { type: 'key', key: { name: 'tab' } }).state;
  return reduce(s, { type: 'issues', list, jira, github, now: NOW }).state;
}
const text = (s: State) => screen(s).map(stripAnsi).join('\n');
const typed = (s: State, chars: string) => chars.split('').reduce((st, c) => reduce(st, { type: 'key', key: { name: 'char', ch: c } }).state, s);

describe('issues view', () => {
  test('lists both sources with the trackers and each issue\'s session', () => {
    const t = text(page([sv1, gh42], on('Chris A'), on('mousedown')));
    expect(t).toContain('1 Sessions │ 2 Issues');
    expect(t).toContain('Jira ● connected as Chris A');
    expect(t).toContain('GitHub ● mousedown');
    expect(t).toContain('SV-1');
    expect(t).toContain('Fix the payout email');
    expect(t).toContain('GH-42');
    expect(t).toContain('◆ needs you');
    expect(t).toContain('2 issues');
  });

  test('the token is masked in the form', () => {
    let s = typed(page([], off, off), 'J');
    s = reduce(typed(s, 'x.atlassian.net'), { type: 'key', key: { name: 'enter' } }).state;
    s = reduce(typed(s, 'a@b.io'), { type: 'key', key: { name: 'enter' } }).state;
    const t = text(typed(s, 'sec'));
    expect(t).toContain('API token › •••');
    expect(t).not.toContain('sec');
  });

  test('a rejected Jira token says how to fix it, and GitHub issues still show', () => {
    const t = text(page([gh42], { state: 'rejected', who: null }, on('mousedown')));
    expect(t).toContain('Jira ▲ token rejected — J to reconnect');
    expect(t).toContain('GH-42');
  });

  test('GitHub logged out says G to connect; Jira still lists', () => {
    const t = text(page([sv1], on('Chris A'), off));
    expect(t).toContain('GitHub ○ not connected — G to connect');
    expect(t).toContain('SV-1');
  });

  test('empty states', () => {
    expect(text(page([], off, off))).toContain('Connect a tracker: J for Jira, G for GitHub.');
    expect(text(page([], on('Chris A'), off))).toContain('Nothing assigned to you is open.');
    expect(text(typed(page([sv1], on('Chris A'), off), '/zzz'))).toContain('No issues match "zzz".');
  });
});
