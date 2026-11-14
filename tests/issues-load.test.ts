import { describe, expect, test } from 'bun:test';
import type { Fetch, Run } from '../tui/jira';
import { loadIssues, type LoadDeps } from '../tui/load-issues';

const creds = JSON.stringify({ site: 'https://x.atlassian.net', email: 'a@b.io', token: 't' });
const jiraBody = { issues: [{ key: 'SV-1', fields: { summary: 'Newer', status: { name: 'To Do' }, updated: '2026-11-14T12:00:00Z' } }] };
const ghBody = [{ number: 1, title: 'Older', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-11-14T10:00:00Z', state: 'OPEN' }];

function fakeRun(opts: { ghLoggedIn?: boolean; keychain?: string | null } = {}) {
  const calls: { cmd: string[]; cwd?: string }[] = [];
  const run: Run = async (cmd, _stdin, cwd) => {
    calls.push({ cmd, cwd });
    if (cmd[0] === 'gh' && cmd[1] === 'auth')
      return opts.ghLoggedIn === false ? { code: 1, out: 'You are not logged into any GitHub hosts' } : { code: 0, out: 'Logged in to github.com account mousedown (keyring)' };
    if (cmd[0] === 'gh' && cmd[1] === 'issue') return { code: 0, out: JSON.stringify(ghBody) };
    if (cmd[0] === 'security') return opts.keychain === null ? { code: 44, out: '' } : { code: 0, out: opts.keychain ?? creds };
    return { code: 1, out: '' };
  };
  return { run, calls };
}

function fakeFetch(status = 200) {
  const urls: string[] = [];
  const fetch: Fetch = async (url) => {
    urls.push(url);
    const body = url.includes('/myself') ? { displayName: 'Chris A' } : jiraBody;
    return { status, text: async () => JSON.stringify(body) };
  };
  return { fetch, urls };
}

const deps = (run: Run, fetch: Fetch): LoadDeps => ({ run, fetch, env: {}, platform: 'darwin', file: '/unused', jql: null, prefix: 'SV', repos: ['/r'], keys: [] });

describe('loadIssues', () => {
  test('both sources load into one list, newest first', async () => {
    const { run, calls } = fakeRun();
    const { fetch, urls } = fakeFetch();
    const r = await loadIssues(deps(run, fetch));
    expect(r.list.map((i) => i.key)).toEqual(['SV-1', 'GH-1']);
    expect(r.jira).toEqual({ state: 'connected', who: 'Chris A' });
    expect(r.github).toEqual({ state: 'connected', who: 'mousedown' });
    expect(r.jiraSite).toBe('https://x.atlassian.net');
    expect(calls.find((c) => c.cmd[1] === 'issue')?.cwd).toBe('/r');
    expect(urls.some((u) => u.includes(encodeURIComponent('project = SV AND')))).toBe(true);
  });

  test('a rejected Jira token keeps the GitHub issues', async () => {
    const r = await loadIssues(deps(fakeRun().run, fakeFetch(401).fetch));
    expect(r.jira.state).toBe('rejected');
    expect(r.list.map((i) => i.key)).toEqual(['GH-1']);
  });

  test('no Jira creds: disconnected, and no HTTP call', async () => {
    const { fetch, urls } = fakeFetch();
    const r = await loadIssues(deps(fakeRun({ keychain: null }).run, fetch));
    expect(r.jira).toEqual({ state: 'disconnected', who: null });
    expect(urls).toEqual([]);
    expect(r.jiraSite).toBeNull();
  });

  test('gh logged out: GitHub disconnected, and gh issue list never runs', async () => {
    const { run, calls } = fakeRun({ ghLoggedIn: false });
    const r = await loadIssues(deps(run, fakeFetch().fetch));
    expect(r.github).toEqual({ state: 'disconnected', who: null });
    expect(calls.some((c) => c.cmd[1] === 'issue')).toBe(false);
    expect(r.list.map((i) => i.key)).toEqual(['SV-1']);
  });

  test('the same GitHub issue from two worktrees of one repo is listed once', async () => {
    const { run } = fakeRun();
    const r = await loadIssues({ ...deps(run, fakeFetch().fetch), repos: ['/r', '/r2'] });
    expect(r.list.filter((i) => i.key === 'GH-1')).toHaveLength(1);
  });

  test('tickets the sessions work on are looked up too, without joining the Issues list', async () => {
    const urls: string[] = [];
    const fetch: Fetch = async (url) => {
      urls.push(url);
      if (url.includes('/myself')) return { status: 200, text: async () => JSON.stringify({ displayName: 'Chris A' }) };
      if (decodeURIComponent(url).includes('key in (SV-2829)'))
        return { status: 200, text: async () => JSON.stringify({ issues: [{ key: 'SV-2829', fields: { summary: 'Done already', status: { name: 'Done' }, updated: '2026-11-01T00:00:00Z' } }] }) };
      return { status: 200, text: async () => JSON.stringify(jiraBody) };
    };
    const r = await loadIssues({ ...deps(fakeRun().run, fetch), keys: ['SV-1', 'SV-2829', 'GH-4'] });
    expect(r.list.map((i) => i.key)).toEqual(['SV-1', 'GH-1']);
    expect(r.tickets.map((i) => [i.key, i.title])).toEqual([['SV-2829', 'Done already']]);
    expect(urls.filter((u) => decodeURIComponent(u).includes('key in'))).toHaveLength(1);
  });

  test('no lookup when every session ticket is already listed', async () => {
    const { fetch, urls } = fakeFetch();
    const r = await loadIssues({ ...deps(fakeRun().run, fetch), keys: ['SV-1'] });
    expect(r.tickets).toEqual([]);
    expect(urls.some((u) => decodeURIComponent(u).includes('key in'))).toBe(false);
  });
});
