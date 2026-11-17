import { describe, expect, test } from 'bun:test';
import { fieldText, jqlFor, launchArgs, launchDir, resolveFields, matches, parseGhAuth, parseGhIssues, parseJiraSearch, sessionFor, type Issue } from '../tui/issues';
import { row } from './fixtures';

const jiraIssue: Issue = {
  source: 'jira',
  key: 'SV-1',
  title: 'Fix it',
  status: 'To Do',
  url: 'https://x.atlassian.net/browse/SV-1',
  updatedAt: 1,
  repo: null,
};
const ghIssue: Issue = {
  source: 'github',
  key: 'GH-42',
  title: 'Bug',
  status: 'open',
  url: 'https://github.com/o/r/issues/42',
  updatedAt: 2,
  repo: '/r',
};

describe('issues', () => {
  test('parseJiraSearch reads key, title, status and link', () => {
    const json = JSON.stringify({
      issues: [{ key: 'SV-1', fields: { summary: 'Fix it', status: { name: 'To Do' }, updated: '2026-11-14T10:00:00.000+0000' } }],
    });
    expect(parseJiraSearch(json, 'https://x.atlassian.net')).toEqual([
      {
        source: 'jira',
        key: 'SV-1',
        title: 'Fix it',
        status: 'To Do',
        url: 'https://x.atlassian.net/browse/SV-1',
        updatedAt: Date.parse('2026-11-14T10:00:00.000+0000'),
        repo: null,
      },
    ]);
    expect(parseJiraSearch('nope', 'https://x')).toEqual([]);
  });

  test('parseGhIssues keys GitHub issues GH-<n>', () => {
    const json = JSON.stringify([{ number: 42, title: 'Bug', url: 'https://github.com/o/r/issues/42', updatedAt: '2026-11-14T10:00:00Z', state: 'OPEN' }]);
    expect(parseGhIssues(json, '/repo')[0]).toMatchObject({ source: 'github', key: 'GH-42', status: 'open', repo: '/repo' });
    expect(parseGhIssues('', '/repo')).toEqual([]);
  });

  test('parseGhAuth reads the login, and none when logged out', () => {
    expect(parseGhAuth('  ✓ Logged in to github.com account mousedown (keyring)', 0)).toEqual({ login: 'mousedown' });
    expect(parseGhAuth('You are not logged into any GitHub hosts', 1)).toEqual({ login: null });
    expect(parseGhAuth('github.com\n  ✓ Logged in to github.com as octocat (oauth_token)', 0)).toEqual({ login: 'octocat' });
  });

  test('jqlFor narrows to the key prefix, and a custom query wins', () => {
    const base = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
    expect(jqlFor(null, null)).toBe(base);
    expect(jqlFor('SV', null)).toBe(`project = SV AND ${base}`);
    expect(jqlFor('SV', 'project = X')).toBe('project = X');
  });

  test('sessionFor picks the newest session for the key', () => {
    const old = row({ id: 'old', key: 'SV-1', startedAt: 1 });
    const fresh = row({ id: 'new', key: 'SV-1', startedAt: 2 });
    const other = row({ id: 'x', key: 'SV-9', startedAt: 3 });
    expect(sessionFor(jiraIssue, [old, fresh, other])?.id).toBe('new');
    expect(sessionFor(ghIssue, [old])).toBeNull();
    expect(sessionFor(ghIssue, [row({ id: 'g', key: null, label: 'GH-42' })])?.id).toBe('g');
  });

  test('launchArgs: the key for Jira, the repo and URL for GitHub', () => {
    expect(launchArgs(jiraIssue)).toBe('SV-1');
    expect(launchArgs(ghIssue)).toBe('--repo "/r" https://github.com/o/r/issues/42');
  });

  test('matches filters on key and title, ignoring case', () => {
    expect(matches(jiraIssue, 'fix')).toBe(true);
    expect(matches(jiraIssue, 'sv-1')).toBe(true);
    expect(matches(jiraIssue, '')).toBe(true);
    expect(matches(jiraIssue, 'zzz')).toBe(false);
  });
});

describe('extra Jira fields', () => {
  test('parseJiraSearch reads the asked-for fields by their label', () => {
    const json = JSON.stringify({ issues: [{ key: 'SV-1', fields: { summary: 'x', customfield_1: { value: 'P2' } } }, { key: 'SV-2', fields: { summary: 'y' } }] });
    const [a, b] = parseJiraSearch(json, 'https://x', [{ label: 'Launch Priority', id: 'customfield_1' }]);
    expect(a.extra).toEqual({ 'Launch Priority': 'P2' });
    expect(b.extra).toEqual({ 'Launch Priority': '' });
    expect(parseJiraSearch(json, 'https://x')[0].extra).toBeUndefined();
  });

  test('fieldText flattens options, users, cascades and lists', () => {
    expect(fieldText({ value: 'P2' })).toBe('P2');
    expect(fieldText({ displayName: 'Chris A' })).toBe('Chris A');
    expect(fieldText({ value: 'A', child: { value: 'B' } })).toBe('A / B');
    expect(fieldText([{ name: 'x' }, { name: 'y' }])).toBe('x, y');
    expect(fieldText(3)).toBe('3');
    expect(fieldText(null)).toBe('');
  });

  test('resolveFields matches an id, else a name ignoring case, and drops unknowns', () => {
    const known = [{ id: 'customfield_1', name: 'Launch Priority' }, { id: 'priority', name: 'Priority' }];
    expect(resolveFields(['launch priority', 'priority', 'Nope'], known)).toEqual([
      { label: 'launch priority', id: 'customfield_1' },
      { label: 'priority', id: 'priority' },
    ]);
  });
});

describe('launchDir', () => {
  const rows = [
    { key: 'SV-1', cwd: '/web/.claude/worktrees/a', startedAt: 1 },
    { key: 'SV-2', cwd: '/web/.claude/worktrees/b', startedAt: 2 },
    { key: 'OPS-1', cwd: '/ops', startedAt: 3 },
    { key: null, cwd: '/x', startedAt: 4 },
  ];
  test('a Jira key runs where the newest session on its project ran', () => {
    expect(launchDir('SV-4244', rows)).toBe('/web/.claude/worktrees/b');
    expect(launchDir('OPS-9 OPS-10', rows)).toBe('/ops');
  });
  test('an explicit repo, an unknown project, GitHub or a description decide nothing', () => {
    expect(launchDir('--repo "/r" SV-4244', rows)).toBeNull();
    expect(launchDir('ABC-1', rows)).toBeNull();
    expect(launchDir('GH-3', rows)).toBeNull();
    expect(launchDir('"fix the footer"', rows)).toBeNull();
  });
});
