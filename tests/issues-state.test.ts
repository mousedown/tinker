import { describe, expect, test } from 'bun:test';
import type { Issue } from '../tui/issues';
import type { Key } from '../tui/runtime/keys';
import { initialState, reduce, shownIssues, type State, type Tracker } from '../tui/state';
import { NOW, row } from './fixtures';

const ch = (c: string): Key => ({ name: 'char', ch: c });
const named = (name: Key['name']): Key => ({ name });
const press = (s: State, ...keys: (Key | string)[]) =>
  keys.reduce((st, k) => reduce(st, { type: 'key', key: typeof k === 'string' ? ch(k) : k }).state, s);
const typed = (s: State, text: string) => press(s, ...text.split(''));

const sv1: Issue = { source: 'jira', key: 'SV-1', title: 'Fix the payout email', status: 'To Do', url: 'https://x.atlassian.net/browse/SV-1', updatedAt: 3, repo: null };
const sv2: Issue = { source: 'jira', key: 'SV-2', title: 'Old thing', status: 'To Do', url: 'https://x.atlassian.net/browse/SV-2', updatedAt: 1, repo: null };
const gh2: Issue = { source: 'github', key: 'GH-2', title: 'Export button', status: 'open', url: 'https://github.com/o/r/issues/2', updatedAt: 2, repo: '/r' };
const on: Tracker = { state: 'connected', who: 'Chris' };
const off: Tracker = { state: 'disconnected', who: null };

function issuesPage(rows = [row({ id: 'w', key: 'SV-9', state: 'done' })], github: Tracker = on): State {
  let s = reduce(initialState(140, 40), { type: 'rows', rows, now: NOW }).state;
  s = reduce(s, { type: 'key', key: named('tab') }).state;
  return reduce(s, { type: 'issues', list: [sv2, gh2, sv1], jira: on, github, now: NOW }).state;
}

describe('issues page', () => {
  test('tab opens the issues page and loads it; tab again goes back', () => {
    const s = reduce(initialState(140, 40), { type: 'key', key: named('tab') });
    expect(s.state.page).toBe('issues');
    expect(s.effects).toEqual([{ type: 'load-issues' }]);
    expect(press(s.state, named('tab')).page).toBe('sessions');
  });

  test('f still toggles the session filter', () => {
    expect(press(initialState(140, 40), 'f').filter).toBe('all');
  });

  test('issues show newest first', () => {
    expect(shownIssues(issuesPage()).map((i) => i.key)).toEqual(['SV-1', 'GH-2', 'SV-2']);
  });

  test('enter launches the ticked issues and returns to sessions', () => {
    const s = press(issuesPage(), ' ', named('down'), ' ');
    const step = reduce(s, { type: 'key', key: named('enter') });
    expect(step.effects).toEqual([{ type: 'launch-batch', batches: ['SV-1', '--repo "/r" https://github.com/o/r/issues/2'] }]);
    expect(step.state.page).toBe('sessions');
    expect(step.state.issues.marks).toEqual([]);
    expect(Object.keys(step.state.pending)).toEqual(['SV-1', 'GH-2']);
  });

  test('enter with nothing ticked launches the selected issue', () => {
    const step = reduce(press(issuesPage(), named('down')), { type: 'key', key: named('enter') });
    expect(step.effects).toEqual([{ type: 'launch-batch', batches: ['--repo "/r" https://github.com/o/r/issues/2'] }]);
  });

  test('an issue with a live session is skipped and said so, never launched twice', () => {
    const s = issuesPage([row({ id: 'w', key: 'SV-1', state: 'working' })]);
    const one = reduce(s, { type: 'key', key: named('enter') });
    expect(one.effects).toEqual([]);
    expect(one.state.message?.text).toBe('SV-1 already has a running session; tab to see it.');
    const both = reduce(press(s, '*'), { type: 'key', key: named('enter') });
    expect(both.effects).toEqual([{ type: 'launch-batch', batches: ['SV-2', '--repo "/r" https://github.com/o/r/issues/2'] }]);
    expect(both.state.message?.text).toContain('skipped SV-1, it already has a running session');
  });

  test('several Jira issues go to the launcher in one call, GitHub ones in one call per repo', () => {
    const other: Issue = { ...gh2, key: 'GH-3', url: 'https://github.com/o/q/issues/3', repo: '/q' };
    const gh5: Issue = { ...gh2, key: 'GH-5', url: 'https://github.com/o/r/issues/5' };
    let s = reduce(issuesPage(), { type: 'issues', list: [sv1, sv2, gh2, gh5, other], jira: on, github: on, now: NOW }).state;
    s = press(s, '*');
    const step = reduce(s, { type: 'key', key: named('enter') });
    expect(step.effects).toEqual([
      { type: 'launch-batch', batches: ['SV-1 SV-2', '--repo "/r" https://github.com/o/r/issues/2 https://github.com/o/r/issues/5', '--repo "/q" https://github.com/o/q/issues/3'] },
    ]);
  });

  test('two repos\' GH-7 are separate rows: the cursor moves past them and ticks are per row', () => {
    const a: Issue = { ...gh2, key: 'GH-7', url: 'https://github.com/o/a/issues/7', repo: '/a', updatedAt: 9 };
    const b: Issue = { ...gh2, key: 'GH-7', url: 'https://github.com/o/b/issues/7', repo: '/b', updatedAt: 8 };
    const s = reduce(issuesPage(), { type: 'issues', list: [a, b, sv1], jira: on, github: on, now: NOW }).state;
    const down2 = press(s, named('down'), named('down'));
    expect(down2.issues.selKey).toBe(sv1.url);
    const ticked = press(s, named('down'), ' ');
    expect(ticked.issues.marks).toEqual([b.url]);
  });

  test('/ filters as you type; a filter with no matches launches nothing', () => {
    let s = typed(press(issuesPage(), '/'), 'export');
    expect(shownIssues(s).map((i) => i.key)).toEqual(['GH-2']);
    s = press(s, named('enter'));
    expect(s.issues.filtering).toBe(false);
    expect(s.issues.filter).toBe('export');
    const none = press(typed(press(issuesPage(), '/'), 'zzz'), named('enter'));
    const step = reduce(none, { type: 'key', key: named('enter') });
    expect(step.effects).toEqual([]);
    expect(step.state.message?.text).toBe('Nothing selected.');
  });

  test('esc while filtering clears the filter; esc otherwise goes back', () => {
    const s = press(typed(press(issuesPage(), '/'), 'ex'), named('esc'));
    expect(s.issues.filter).toBe('');
    expect(s.page).toBe('issues');
    expect(press(s, named('esc')).page).toBe('sessions');
  });

  test('* ticks every shown issue, and again unticks them', () => {
    const s = press(issuesPage(), '*');
    expect(s.issues.marks.sort()).toEqual([gh2.url, sv1.url, sv2.url].sort());
    expect(press(s, '*').issues.marks).toEqual([]);
  });

  test('o opens the selected issue; r reloads', () => {
    expect(reduce(issuesPage(), { type: 'key', key: ch('o') }).effects).toEqual([{ type: 'open', url: sv1.url }]);
    expect(reduce(issuesPage(), { type: 'key', key: ch('r') }).effects).toEqual([{ type: 'load-issues' }]);
  });

  test('J opens the Atlassian token page and the form', () => {
    const step = reduce(issuesPage(), { type: 'key', key: ch('J') });
    expect(step.effects).toEqual([{ type: 'open', url: 'https://id.atlassian.com/manage-profile/security/api-tokens' }]);
    expect(step.state.input).toEqual({ kind: 'jira', field: 'site', site: '', email: '', token: '' });
  });

  test('the Jira form walks site, email, token and emits jira-connect, then forgets the token', () => {
    let s = press(issuesPage(), 'J');
    s = press(typed(s, 'x.atlassian.net'), named('enter'));
    s = press(typed(s, 'a@b.io'), named('enter'));
    s = typed(s, 'tok3n');
    const last = reduce(s, { type: 'key', key: named('enter') });
    expect(last.effects).toEqual([{ type: 'jira-connect', site: 'x.atlassian.net', email: 'a@b.io', token: 'tok3n' }]);
    expect(JSON.stringify(last.state)).not.toContain('tok3n');
    expect(press(press(issuesPage(), 'J'), named('esc')).input).toBeNull();
  });

  test('G logs in only when GitHub is disconnected', () => {
    const connected = reduce(issuesPage(), { type: 'key', key: ch('G') });
    expect(connected.effects).toEqual([]);
    expect(connected.state.message?.text).toBe('GitHub is connected as Chris.');
    expect(reduce(issuesPage(undefined, off), { type: 'key', key: ch('G') }).effects).toEqual([{ type: 'gh-login' }]);
  });

  test('a reload keeps the selection when the issue is still there', () => {
    const s = press(issuesPage(), named('down'));
    expect(s.issues.selKey).toBe(gh2.url);
    const again = reduce(s, { type: 'issues', list: [gh2, sv1], jira: on, github: on, now: NOW }).state;
    expect(again.issues.selKey).toBe(gh2.url);
  });
});

describe('page-scoped messages', () => {
  test('a message meant for the issues page is dropped on the sessions page', () => {
    const sessions = initialState(140, 40);
    expect(reduce(sessions, { type: 'message', text: 'Jira rejected that email and token.', tone: 'error', page: 'issues' }).state.message).toBeNull();
    const issues = reduce(sessions, { type: 'key', key: { name: 'tab' } }).state;
    expect(reduce(issues, { type: 'message', text: 'Jira rejected that email and token.', tone: 'error', page: 'issues' }).state.message?.text).toBe(
      'Jira rejected that email and token.'
    );
  });
});
