import type { Row } from './data';

export type Source = 'jira' | 'github';

export interface Issue {
  source: Source;
  /** `ABC-123` for Jira, `GH-42` for GitHub: the name a Tinker session takes. */
  key: string;
  title: string;
  status: string;
  url: string;
  updatedAt: number;
  /** The local repo a GitHub issue belongs to; null for Jira. */
  repo: string | null;
}

interface JiraSearch {
  issues?: { key: string; fields?: { summary?: string; status?: { name?: string }; updated?: string } }[];
}

export function parseJiraSearch(json: string, site: string): Issue[] {
  try {
    return ((JSON.parse(json) as JiraSearch).issues ?? []).map((i) => ({
      source: 'jira',
      key: i.key,
      title: i.fields?.summary ?? '',
      status: i.fields?.status?.name ?? '',
      url: `${site}/browse/${i.key}`,
      updatedAt: Date.parse(i.fields?.updated ?? '') || 0,
      repo: null,
    }));
  } catch {
    return [];
  }
}

interface GhIssue {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
}

export function parseGhIssues(json: string, repo: string): Issue[] {
  try {
    return (JSON.parse(json) as GhIssue[]).map((i) => ({
      source: 'github',
      key: `GH-${i.number}`,
      title: i.title,
      status: 'open',
      url: i.url,
      updatedAt: Date.parse(i.updatedAt) || 0,
      repo,
    }));
  } catch {
    return [];
  }
}

export function parseGhAuth(out: string, code: number): { login: string | null } {
  if (code !== 0) return { login: null };
  return { login: /Logged in to \S+ (?:account|as) (\S+)/.exec(out)?.[1] ?? null };
}

const MINE = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';

export function jqlFor(prefix: string | null, custom: string | null): string {
  if (custom) return custom;
  return prefix ? `project = ${prefix} AND ${MINE}` : MINE;
}

/** The newest session working on this issue, if any. */
export function sessionFor(issue: Issue, rows: Row[]): Row | null {
  let best: Row | null = null;
  for (const r of rows) if ((r.key ?? r.label) === issue.key && (!best || r.startedAt > best.startedAt)) best = r;
  return best;
}

/** What the launcher is given: a Jira key as it is, a GitHub issue by its URL in its own repo. */
export function launchArgs(issue: Issue): string {
  return issue.source === 'jira' ? issue.key : `--repo "${issue.repo}" ${issue.url}`;
}

/** One launcher call for all the Jira keys, and one per repo for GitHub, so the launcher's capacity check sees them together. */
export function launchBatches(issues: Issue[]): string[] {
  const jira = issues.filter((i) => i.source === 'jira').map((i) => i.key);
  const byRepo = new Map<string, string[]>();
  for (const i of issues) if (i.source === 'github') byRepo.set(i.repo ?? '', [...(byRepo.get(i.repo ?? '') ?? []), i.url]);
  return [...(jira.length ? [jira.join(' ')] : []), ...[...byRepo].map(([repo, urls]) => `--repo "${repo}" ${urls.join(' ')}`)];
}

export function matches(issue: Issue, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  return !f || issue.key.toLowerCase().includes(f) || issue.title.toLowerCase().includes(f);
}
