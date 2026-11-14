import { describe, expect, test } from 'bun:test';
import { mkdtempSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { credsFromEnv, jiraMyself, jiraSearch, keychainLine, loadCreds, normaliseSite, saveCreds, type Creds, type Fetch, type Run } from '../tui/jira';
import { loadSettings } from '../tui/settings';

const c: Creds = { site: 'https://x.atlassian.net', email: 'a@b.io', token: `t "$x' y` };
const tmp = () => mkdtempSync(join(tmpdir(), 'tinker-jira-'));

function recorder(out = '', code = 0) {
  const calls: { cmd: string[]; stdin?: string }[] = [];
  const run: Run = async (cmd, stdin) => {
    calls.push({ cmd, stdin });
    return { code, out };
  };
  return { calls, run };
}

const reply = (status: number, body: unknown): ReturnType<Fetch> => Promise.resolve({ status, text: async () => JSON.stringify(body) });

describe('jira credentials', () => {
  test('keychainLine hex-encodes, so quotes and spaces survive', () => {
    const line = keychainLine(c);
    expect(line).toStartWith('add-generic-password -U -s tinker-jira -a tinker -X ');
    expect(line).toEndWith('\n');
    expect(line).not.toContain('t "$x');
    const hex = line.trim().split(' ').pop()!;
    expect(JSON.parse(Buffer.from(hex, 'hex').toString())).toEqual(c);
  });

  test('saveCreds on darwin passes the secret on stdin only', async () => {
    const { calls, run } = recorder();
    await saveCreds(c, run, 'darwin', '/unused');
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toEqual(['security', '-i']);
    expect(calls[0].cmd.join(' ')).not.toContain('t "$x');
    expect(calls[0].stdin).toBe(keychainLine(c));
  });

  test('saveCreds off darwin writes a file only you can read, and loadCreds reads it back', async () => {
    const file = join(tmp(), 'tinker', 'jira.json');
    const { run, calls } = recorder();
    await saveCreds(c, run, 'linux', file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(calls).toHaveLength(0);
    expect(await loadCreds(run, {}, 'linux', file)).toEqual(c);
  });

  test('loadCreds prefers the environment, then the keychain', async () => {
    const env = { JIRA_BASE_URL: 'https://y.atlassian.net/', JIRA_EMAIL: 'e@f.io', JIRA_API_TOKEN: 'tok' };
    const { run, calls } = recorder(JSON.stringify(c));
    expect(await loadCreds(run, env, 'darwin', '/unused')).toEqual({ site: 'https://y.atlassian.net', email: 'e@f.io', token: 'tok' });
    expect(calls).toHaveLength(0);
    expect(await loadCreds(run, {}, 'darwin', '/unused')).toEqual(c);
    expect(calls[0].cmd).toEqual(['security', 'find-generic-password', '-s', 'tinker-jira', '-a', 'tinker', '-w']);
  });

  test('loadCreds is null when nothing is stored', async () => {
    expect(await loadCreds(recorder('', 44).run, {}, 'darwin', '/unused')).toBeNull();
    expect(await loadCreds(recorder().run, {}, 'linux', join(tmp(), 'none.json'))).toBeNull();
    expect(credsFromEnv({ JIRA_BASE_URL: 'x', JIRA_EMAIL: 'e' })).toBeNull();
  });

  test('normaliseSite keeps only https and the host', () => {
    expect(normaliseSite('x.atlassian.net')).toBe('https://x.atlassian.net');
    expect(normaliseSite(' https://x.atlassian.net/ ')).toBe('https://x.atlassian.net');
    expect(normaliseSite('https://x.atlassian.net/jira/software/projects')).toBe('https://x.atlassian.net');
  });
});

describe('jira client', () => {
  test('jiraSearch sends basic auth and asks for my open issues', async () => {
    let seen = { url: '', auth: '' };
    const f: Fetch = (url, init) => {
      seen = { url, auth: init.headers.Authorization };
      return reply(200, { issues: [{ key: 'SV-1', fields: { summary: 's', status: { name: 'To Do' }, updated: '2026-11-14T10:00:00Z' } }] });
    };
    const r = await jiraSearch(c, 'project = SV', f);
    expect(r.ok && r.issues.map((i) => i.key)).toEqual(['SV-1']);
    expect(seen.auth).toBe(`Basic ${Buffer.from(`${c.email}:${c.token}`).toString('base64')}`);
    expect(seen.url).toBe('https://x.atlassian.net/rest/api/3/search/jql?jql=project%20%3D%20SV&fields=summary,status,updated&maxResults=50');
  });

  test('jiraSearch maps 401 to rejected', async () => {
    expect(await jiraSearch(c, 'x', () => reply(401, {}))).toEqual({ ok: false, why: 'rejected', status: 401 });
  });

  test('jiraSearch maps a thrown fetch to unreachable', async () => {
    expect(await jiraSearch(c, 'x', () => Promise.reject(new Error('dns')))).toEqual({ ok: false, why: 'unreachable' });
  });

  test('jiraMyself reads the display name', async () => {
    expect(await jiraMyself(c, () => reply(200, { displayName: 'Chris A' }))).toEqual({ ok: true, name: 'Chris A' });
    expect(await jiraMyself(c, () => reply(403, {}))).toEqual({ ok: false, why: 'rejected' });
    expect(await jiraMyself(c, () => reply(500, {}))).toEqual({ ok: false, why: 'error' });
  });
});

describe('settings', () => {
  test('loadSettings keeps a string jql and drops anything else', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ jql: 'project = X' }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ jql: 5 }));
    expect(loadSettings(join(dir, 'a.json')).jql).toBe('project = X');
    expect(loadSettings(join(dir, 'b.json')).jql).toBeNull();
  });
});
