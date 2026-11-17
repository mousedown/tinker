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
  /** The configured extra fields, by the name the setting gave them; only set when some were asked for. */
  extra?: Record<string, string>;
}

/** A configured extra field: what the setting called it, and the Jira id it resolved to. */
export interface ExtraField {
  label: string;
  id: string;
}

/** A Jira field value as one line: options, users and versions by their name, lists joined. */
export function fieldText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(fieldText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const own = fieldText(o.value ?? o.name ?? o.displayName ?? o.key ?? '');
    const child = o.child ? fieldText(o.child) : '';
    return child ? `${own} / ${child}` : own;
  }
  return '';
}

interface JiraSearch {
  issues?: { key: string; fields?: { summary?: string; status?: { name?: string }; updated?: string; [id: string]: unknown } }[];
}

export function parseJiraSearch(json: string, site: string, extra: ExtraField[] = []): Issue[] {
  try {
    return ((JSON.parse(json) as JiraSearch).issues ?? []).map((i) => ({
      source: 'jira',
      key: i.key,
      title: i.fields?.summary ?? '',
      status: i.fields?.status?.name ?? '',
      url: `${site}/browse/${i.key}`,
      updatedAt: Date.parse(i.fields?.updated ?? '') || 0,
      repo: null,
      ...(extra.length ? { extra: Object.fromEntries(extra.map((f) => [f.label, fieldText(i.fields?.[f.id])])) } : {}),
    }));
  } catch {
    return [];
  }
}

/** Each configured field matched to a Jira field by id, else by name ignoring case; unknown ones are dropped. */
export function resolveFields(wanted: string[], known: { id: string; name: string }[]): ExtraField[] {
  const out: ExtraField[] = [];
  for (const label of wanted) {
    const hit = known.find((k) => k.id === label) ?? known.find((k) => k.name.toLowerCase() === label.toLowerCase());
    if (hit) out.push({ label, id: hit.id });
  }
  return out;
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
  if (!f) return true;
  return [issue.key, issue.title, ...Object.values(issue.extra ?? {})].some((t) => t.toLowerCase().includes(f));
}

/**
 * Where a launch with no `--repo` should run: the folder of the newest session on the same project
 * (`SV-` for `SV-12`), so the TUI's own directory doesn't decide. Null when the args name a repo,
 * hold no key, or no session has worked on that project yet.
 */
export function launchDir(args: string, rows: Pick<Row, 'key' | 'cwd' | 'startedAt'>[]): string | null {
  if (/(^|\s)--repo(\s|$)/.test(args)) return null;
  const project = /\b([A-Z][A-Z0-9]*)-\d+\b/.exec(args)?.[1];
  if (!project || project === 'GH') return null;
  const hits = rows.filter((r) => r.key?.startsWith(`${project}-`)).sort((a, b) => b.startedAt - a.startedAt);
  return hits[0]?.cwd ?? null;
}
