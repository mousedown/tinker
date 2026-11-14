import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { parseJiraSearch, type Issue } from './issues';

/** A Jira Cloud site and an API token. The token never reaches argv, the screen or a message. */
export interface Creds {
  site: string;
  email: string;
  token: string;
}

export type Run = (cmd: string[], stdin?: string, cwd?: string) => Promise<{ code: number; out: string }>;

export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;

export type Why = 'rejected' | 'unreachable' | 'error';

export type JiraResult = { ok: true; issues: Issue[] } | { ok: false; why: Why; status?: number };

const SERVICE = 'tinker-jira';
const ACCOUNT = 'tinker';

export const TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';

export function credsFile(env: Record<string, string | undefined> = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tinker', 'jira.json');
}

/** `x.atlassian.net`, `https://x.atlassian.net/jira/…` → `https://x.atlassian.net`. */
export function normaliseSite(input: string): string {
  const s = input.trim();
  try {
    return `https://${new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).host}`;
  } catch {
    return s.replace(/\/+$/, '');
  }
}

export function credsFromEnv(env: Record<string, string | undefined>): Creds | null {
  const { JIRA_BASE_URL: site, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = env;
  return site && email && token ? { site: normaliseSite(site), email, token } : null;
}

function parseCreds(text: string): Creds | null {
  try {
    const c = JSON.parse(text) as Partial<Creds>;
    return c.site && c.email && c.token ? { site: c.site, email: c.email, token: c.token } : null;
  } catch {
    return null;
  }
}

/** One `security -i` command. Hex keeps quotes and spaces intact, and stdin keeps the secret out of argv. */
export function keychainLine(c: Creds): string {
  return `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -X ${Buffer.from(JSON.stringify(c)).toString('hex')}\n`;
}

export async function loadCreds(run: Run, env: Record<string, string | undefined>, platform: string, file: string): Promise<Creds | null> {
  const fromEnv = credsFromEnv(env);
  if (fromEnv) return fromEnv;
  if (platform === 'darwin') {
    const r = await run(['security', 'find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']);
    return r.code === 0 ? parseCreds(r.out.trim()) : null;
  }
  return existsSync(file) ? parseCreds(readFileSync(file, 'utf8')) : null;
}

export async function saveCreds(c: Creds, run: Run, platform: string, file: string): Promise<void> {
  if (platform === 'darwin') {
    const r = await run(['security', '-i'], keychainLine(c));
    if (r.code !== 0) throw new Error('the keychain refused the item');
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
  chmodSync(file, 0o600);
}

function headers(c: Creds): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${c.email}:${c.token}`).toString('base64')}`, Accept: 'application/json' };
}

async function get(c: Creds, path: string, fetch: Fetch): Promise<{ ok: true; body: string } | { ok: false; why: Why; status?: number }> {
  let res: Awaited<ReturnType<Fetch>>;
  try {
    res = await fetch(`${c.site}${path}`, { headers: headers(c) });
  } catch {
    return { ok: false, why: 'unreachable' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, why: 'rejected', status: res.status };
  if (res.status !== 200) return { ok: false, why: 'error', status: res.status };
  return { ok: true, body: await res.text() };
}

export async function jiraMyself(c: Creds, fetch: Fetch): Promise<{ ok: true; name: string } | { ok: false; why: Why }> {
  const r = await get(c, '/rest/api/3/myself', fetch);
  if (!r.ok) return { ok: false, why: r.why };
  try {
    return { ok: true, name: (JSON.parse(r.body) as { displayName?: string }).displayName ?? c.email };
  } catch {
    return { ok: false, why: 'error' };
  }
}

export async function jiraSearch(c: Creds, jql: string, fetch: Fetch): Promise<JiraResult> {
  const r = await get(c, `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status,updated&maxResults=50`, fetch);
  return r.ok ? { ok: true, issues: parseJiraSearch(r.body, c.site) } : r;
}
