import { describe, expect, test } from 'bun:test';
import type { Issue } from '../tui/issues';
import type { Key } from '../tui/runtime/keys';
import { stripAnsi } from '../tui/render/text';
import { initialState, reduce, ticketOf, type State, type Tracker } from '../tui/state';
import { screen } from '../tui/view';
import { NOW, pr, row } from './fixtures';

const on: Tracker = { state: 'connected', who: 'Chris' };
const k = (c: string): Key => ({ name: 'char', ch: c });
const press = (s: State, ...keys: (Key | string)[]) => keys.reduce((st, x) => reduce(st, { type: 'key', key: typeof x === 'string' ? k(x) : x }).state, s);

const sv7: Issue = { source: 'jira', key: 'SV-7', title: 'Payout email shows the wrong currency', status: 'In Progress', url: 'https://x.atlassian.net/browse/SV-7', updatedAt: 5, repo: null };
const sv8: Issue = { source: 'jira', key: 'SV-8', title: 'Untouched ticket', status: 'To Do', url: 'https://x.atlassian.net/browse/SV-8', updatedAt: 4, repo: null };
const worker = row({
  id: 'w7',
  key: 'SV-7',
  label: 'SV-7',
  name: '🐙 SV-7',
  state: 'blocked',
  pr: pr({ number: 3149, url: 'https://github.com/o/r/pull/3149', state: 'OPEN', draft: false, ci: 'fail', checks: { pass: 4, fail: 2, pending: 0 }, checksUrl: 'https://github.com/o/r/pull/3149/checks' }),
});
const orphan = row({ id: 'w9', key: 'SV-9', label: 'SV-9', name: '🐙 SV-9', state: 'working' });

function loaded(): State {
  let s = reduce(initialState(160, 30), { type: 'rows', rows: [worker, orphan], now: NOW }).state;
  return reduce(s, { type: 'issues', list: [sv7, sv8], jira: on, github: on, jiraSite: 'https://x.atlassian.net', now: NOW }).state;
}
const plain = (s: State) => screen(s).map(stripAnsi).join('\n');
const raw = (s: State) => screen(s).join('\n');
const link = (url: string) => `\x1b]8;;${url}\x1b\\`;

describe('number keys switch pages', () => {
  test('2 opens Issues and loads it, 1 comes back', () => {
    const two = reduce(loaded(), { type: 'key', key: k('2') });
    expect(two.state.page).toBe('issues');
    expect(two.effects).toEqual([{ type: 'load-issues' }]);
    expect(press(two.state, '1').page).toBe('sessions');
  });

  test('numbers type into the filter and the Jira form instead of switching', () => {
    const filtering = press(loaded(), '2', '/', '1', '2');
    expect(filtering.page).toBe('issues');
    expect(filtering.issues.filter).toBe('12');
    const form = press(loaded(), '2', 'J', '2');
    expect(form.input).toMatchObject({ kind: 'jira', site: '2' });
  });

  test('the title line shows both pages, with their numbers', () => {
    expect(plain(loaded())).toContain('1 Sessions │ 2 Issues');
  });
});

describe('tickets and their work, linked both ways', () => {
  test('ticketOf finds the ticket, or links a Jira key on the known site', () => {
    const s = loaded();
    expect(ticketOf(worker, s.issues)).toEqual({ url: sv7.url, title: sv7.title });
    expect(ticketOf(orphan, s.issues)).toEqual({ url: 'https://x.atlassian.net/browse/SV-9', title: null });
    expect(ticketOf(row({ key: null, label: 'the export button' }), s.issues)).toEqual({ url: null, title: null });
    const known = reduce(s, { type: 'issues', list: [sv7], tickets: [{ ...sv8, key: 'SV-9', title: 'Closed last week', url: 'https://x.atlassian.net/browse/SV-9' }], jira: on, github: on, now: NOW }).state;
    expect(ticketOf(orphan, known.issues)).toEqual({ url: 'https://x.atlassian.net/browse/SV-9', title: 'Closed last week' });
  });

  test('Sessions: the key links to the ticket and its title shows', () => {
    const s = loaded();
    expect(raw(s)).toContain(link(sv7.url));
    expect(raw(s)).toContain(link('https://x.atlassian.net/browse/SV-9'));
    expect(plain(s)).toContain('Payout email shows');
  });

  test('Issues: a ticket with a worker shows its state, PR and CI, each linked', () => {
    const s = press(loaded(), '2');
    const t = plain(s);
    expect(t).toContain('✕ CI failing');
    expect(t).toContain('#3149');
    expect(t).toContain('✕2');
    expect(raw(s)).toContain(link(sv7.url));
    expect(raw(s)).toContain(link('https://github.com/o/r/pull/3149'));
    expect(raw(s)).toContain(link('https://github.com/o/r/pull/3149/checks'));
  });

  test('the detail view names the ticket, linked', () => {
    const s = press(loaded(), { name: 'enter' });
    expect(s.view).toBe('detail');
    expect(plain(s)).toMatch(/issue\s+SV-7\s+Payout email shows the wrong currency/);
    expect(raw(s)).toContain(link(sv7.url));
  });
});
