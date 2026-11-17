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

describe('configured issue fields', () => {
  test('each one is a column after STATUS, filled from the issue or a dash', () => {
    let s = page([{ ...sv1, extra: { 'Launch Priority': 'P2' } }, gh42], on('Chris A'), on('mousedown'));
    s = { ...s, settings: { ...s.settings, issueFields: ['Launch Priority'] } };
    const l = screen(s).map(stripAnsi);
    const head = l.find((x) => x.includes('STATUS'))!;
    expect(head.indexOf('LAUNCH PRIORITY')).toBeGreaterThan(head.indexOf('STATUS'));
    expect(l.find((x) => x.includes('SV-1'))).toContain('P2');
    expect(l.find((x) => x.includes('GH-42'))).toContain('—');
  });

  test('the filter matches their values', () => {
    let s = page([{ ...sv1, extra: { 'Launch Priority': 'P2' } }, gh42], on('Chris A'), on('mousedown'));
    s = typed(s, '/p2');
    expect(text(s)).toContain('SV-1');
    expect(text(s)).not.toContain('GH-42');
  });
});

describe('n on the Issues page', () => {
  test('opens the new-issue prompt, and launching it shows the sessions', () => {
    let s = typed(page([sv1], on('Chris A'), off), 'n');
    expect(s.input).toEqual({ kind: 'new', text: '' });
    expect(text(s)).toContain('New issue ›');
    s = typed(s, 'SV-4244');
    const step = reduce(s, { type: 'key', key: { name: 'enter' } });
    expect(step.effects).toEqual([{ type: 'launch', args: 'SV-4244' }]);
    expect(step.state.page).toBe('sessions');
  });
});

describe('m on the Issues page', () => {
  test('opens a menu that starts tinker on the selected issue', () => {
    const s = typed(page([sv1], on('Chris A'), off), 'm');
    expect(s.menu).toBe(0);
    const t = text(s);
    expect(t).toContain('Start tinker on SV-1');
    expect(t).toContain('Start tinker on another issue…');
    const step = reduce(s, { type: 'key', key: { name: 'enter' } });
    expect(step.effects).toEqual([{ type: 'launch-batch', batches: ['SV-1'] }]);
    expect(step.state.page).toBe('sessions');
    expect(step.state.menu).toBeNull();
  });

  test('its letters run items, and esc closes it', () => {
    const s = typed(page([sv1], on('Chris A'), off), 'm');
    expect(typed(s, 'n').input).toEqual({ kind: 'new', text: '' });
    expect(reduce(s, { type: 'key', key: { name: 'esc' } }).state.menu).toBeNull();
    expect(reduce(s, { type: 'key', key: { name: 'char', ch: 'o' } }).effects).toEqual([{ type: 'open', url: 'u1' }]);
  });
});

describe('the STATUS column', () => {
  test('stays on a narrow terminal with a configured field, after SESSION, PR and CI have gone', () => {
    let s = page([{ ...sv1, extra: { 'Launch Priority': 'P2' } }], on('Chris A'), off);
    s = { ...s, width: 80, settings: { ...s.settings, issueFields: ['Launch Priority'] } };
    const l = screen(s).map(stripAnsi);
    const head = l.find((x) => x.includes('KEY'))!;
    expect(head).toContain('STATUS');
    expect(head).toContain('LAUNCH PRIORITY');
    expect(l.find((x) => x.includes('SV-1'))).toContain('To Do');
  });
});
