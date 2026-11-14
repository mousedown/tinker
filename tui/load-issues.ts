import { jqlFor, parseGhAuth, parseGhIssues, type Issue } from './issues';
import { jiraMyself, jiraSearch, loadCreds, type Fetch, type Run } from './jira';
import type { Tracker } from './state';

export interface LoadDeps {
  run: Run;
  fetch: Fetch;
  env: Record<string, string | undefined>;
  platform: string;
  file: string;
  jql: string | null;
  prefix: string | null;
  /** Local repos to list GitHub issues from. */
  repos: string[];
}

const DISCONNECTED: Tracker = { state: 'disconnected', who: null };

async function github(d: LoadDeps): Promise<{ tracker: Tracker; issues: Issue[] }> {
  const auth = await d.run(['gh', 'auth', 'status', '--hostname', 'github.com']);
  const { login } = parseGhAuth(auth.out, auth.code);
  if (!login) return { tracker: DISCONNECTED, issues: [] };
  const lists = await Promise.all(
    d.repos.map(async (repo) => {
      const r = await d.run(
        ['gh', 'issue', 'list', '--assignee', '@me', '--state', 'open', '--limit', '50', '--json', 'number,title,url,updatedAt,state'],
        undefined,
        repo
      );
      return r.code === 0 ? parseGhIssues(r.out, repo) : [];
    })
  );
  const byUrl = new Map<string, Issue>();
  for (const i of lists.flat()) if (!byUrl.has(i.url)) byUrl.set(i.url, i);
  return { tracker: { state: 'connected', who: login }, issues: [...byUrl.values()] };
}

async function jira(d: LoadDeps): Promise<{ tracker: Tracker; issues: Issue[] }> {
  const creds = await loadCreds(d.run, d.env, d.platform, d.file);
  if (!creds) return { tracker: DISCONNECTED, issues: [] };
  const [me, found] = await Promise.all([jiraMyself(creds, d.fetch), jiraSearch(creds, jqlFor(d.prefix, d.jql), d.fetch)]);
  if (!found.ok) return { tracker: { state: found.why === 'rejected' ? 'rejected' : 'unreachable', who: null }, issues: [] };
  return { tracker: { state: 'connected', who: me.ok ? me.name : creds.email }, issues: found.issues };
}

/** Both trackers at once; one failing never hides the other's issues. */
export async function loadIssues(d: LoadDeps): Promise<{ list: Issue[]; jira: Tracker; github: Tracker }> {
  const [j, g] = await Promise.all([jira(d), github(d)]);
  return { list: [...j.issues, ...g.issues].sort((a, b) => b.updatedAt - a.updatedAt), jira: j.tracker, github: g.tracker };
}
