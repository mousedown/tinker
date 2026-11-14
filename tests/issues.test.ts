import { describe, expect, test } from 'bun:test';
import { jqlFor, launchArgs, matches, parseGhAuth, parseGhIssues, parseJiraSearch, sessionFor, type Issue } from '../tui/issues';
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
