import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export const TAG = '🐙';

export type SessionState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped' | string;

export interface Session {
  id: string;
  sessionId: string;
  cwd: string;
  state: SessionState;
  startedAt: number;
  name: string;
  /** The session's process while it is running. */
  pid?: number | null;
}

export type Ci = 'pass' | 'fail' | 'pending' | 'none';

export interface Checks {
  pass: number;
  fail: number;
  pending: number;
  /** Of the failures, those only a person can clear: an approval or review gate. */
  gate?: number;
}

export interface Pr {
  number: number;
  title: string;
  branch: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  draft: boolean;
  ci: Ci;
  checks: Checks;
  checksUrl: string;
  autoMerge: boolean;
  base: string;
}

export interface Verdict {
  kind: 'DONE' | 'PARKED';
  text: string;
}

export type StatusKind = 'green' | 'awaiting-approval' | 'ci-failing' | 'blocked';

export interface Status {
  kind: StatusKind;
  text: string;
}

export interface Activity {
  text: string;
  at: number;
}

export interface Row extends Session {
  key: string | null;
  label: string;
  pr: Pr | null;
  verdict: Verdict | null;
  said: string[];
  activity?: Activity | null;
  status?: Status | null;
}

async function run(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'ignore', env: withoutClaudeCode() });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

export function withoutClaudeCode(): Record<string, string | undefined> {
  const { CLAUDECODE: _, ...env } = process.env;
  return env;
}

export async function sessions(all: boolean): Promise<Session[]> {
  const out = await run(['claude', 'agents', '--json', ...(all ? ['--all'] : [])]);
  try {
    const list = JSON.parse(out) as Session[];
    return list.filter((s) => (s.name ?? '').startsWith(TAG));
  } catch {
    return [];
  }
}

const roots = new Map<string, string>();

export async function repoRoot(cwd: string): Promise<string> {
  const hit = roots.get(cwd);
  if (hit) return hit;
  if (!existsSync(cwd)) return cwd;
  const out = (await run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)).trim();
  const root = out ? dirname(out) : cwd;
  roots.set(cwd, root);
  return root;
}

export function issueKey(name: string): string | null {
  return /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(name)?.[1] ?? null;
}

interface GhPr {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  state: Pr['state'];
  isDraft: boolean;
  baseRefName: string;
  autoMergeRequest: unknown;
  statusCheckRollup: GhCheck[] | null;
}

interface GhCheck {
  name?: string;
  context?: string;
  workflowName?: string;
  conclusion?: string;
  status?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

const FAILED = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'];

function resultOf(c: GhCheck): string {
  return (c.conclusion || c.state || c.status || '').toUpperCase();
}

const PASSED = ['SUCCESS', 'SKIPPED', 'NEUTRAL'];

const GATE = /approv|review[ _-]?gate|protected|code ?owners?|sign[ _-]?off/i;

export function isGate(c: GhCheck): boolean {
  return GATE.test([c.name, c.context, c.workflowName].filter(Boolean).join(' '));
}

export function countChecks(checks: GhCheck[] | null): Checks {
  const out: Checks = { pass: 0, fail: 0, pending: 0, gate: 0 };
  for (const c of checks ?? []) {
    const r = resultOf(c);
    if (FAILED.includes(r)) {
      out.fail++;
      if (r === 'ACTION_REQUIRED' || isGate(c)) out.gate!++;
    } else if (PASSED.includes(r)) out.pass++;
    else out.pending++;
  }
  return out;
}

export function checksUrlOf(prUrl: string, checks: GhCheck[] | null): string {
  const failed = (checks ?? []).find((c) => FAILED.includes(resultOf(c)));
  return failed?.detailsUrl || failed?.targetUrl || `${prUrl}/checks`;
}

function ciOf(checks: GhPr['statusCheckRollup']): Ci {
  if (!checks || checks.length === 0) return 'none';
  const results = checks.map(resultOf);
  if (results.some((r) => FAILED.includes(r))) return 'fail';
  if (results.every((r) => PASSED.includes(r))) return 'pass';
  return 'pending';
}

export async function pulls(cwd: string): Promise<Pr[] | null> {
  if (!existsSync(cwd)) return null;
  const out = await run(
    ['gh', 'pr', 'list', '--state', 'all', '--author', '@me', '--limit', '60', '--json',
      'number,title,headRefName,baseRefName,url,state,isDraft,autoMergeRequest,statusCheckRollup'],
    cwd
  );
  try {
    return (JSON.parse(out) as GhPr[]).map((p) => ({
      number: p.number,
      title: p.title,
      branch: p.headRefName,
      url: p.url,
      state: p.state,
      draft: p.isDraft,
      ci: ciOf(p.statusCheckRollup),
      checks: countChecks(p.statusCheckRollup),
      checksUrl: checksUrlOf(p.url, p.statusCheckRollup),
      autoMerge: Boolean(p.autoMergeRequest),
      base: p.baseRefName,
    }));
  } catch {
    return null;
  }
}

/** The PR the verdict names, else one on the worker's own branch, else one whose title or branch carries the key. */
export function prFor(key: string | null, prs: Pr[], verdict: Verdict | null, branch: string | null = null): Pr | null {
  const fromVerdict = verdict && /\/pull\/(\d+)/.exec(verdict.text)?.[1];
  if (fromVerdict) {
    const hit = prs.find((p) => p.number === Number(fromVerdict));
    if (hit) return hit;
  }
  if (branch) {
    const hits = prs.filter((p) => p.branch === branch);
    const hit = hits.find((p) => p.state === 'OPEN') ?? hits[0];
    if (hit) return hit;
  }
  if (!key) return null;
  const k = key.toLowerCase();
  const hits = prs.filter((p) => p.title.toLowerCase().includes(k) || p.branch.toLowerCase().includes(k));
  return hits.find((p) => p.state === 'OPEN') ?? hits[0] ?? null;
}

const projects = join(homedir(), '.claude', 'projects');
const transcriptPaths = new Map<string, string | null>();

export function transcriptPath(s: Session): string | null {
  if (transcriptPaths.has(s.sessionId)) return transcriptPaths.get(s.sessionId)!;
  const file = `${s.sessionId}.jsonl`;
  const direct = join(projects, s.cwd.replace(/[^A-Za-z0-9]/g, '-'), file);
  let found: string | null = existsSync(direct) ? direct : null;
  if (!found && existsSync(projects)) {
    for (const dir of readdirSync(projects)) {
      const p = join(projects, dir, file);
      if (existsSync(p)) {
        found = p;
        break;
      }
    }
  }
  if (found) transcriptPaths.set(s.sessionId, found);
  return found;
}

const TAIL_BYTES = 256 * 1024;

function tail(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export function assistantTexts(jsonl: string): string[] {
  const texts: string[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant') continue;
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) if (part?.type === 'text' && part.text?.trim()) texts.push(part.text.trim());
    } catch {
      continue;
    }
  }
  return texts;
}

function short(text: string, max = 80): string {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function base(path: unknown): string {
  return typeof path === 'string' ? path.split('/').filter(Boolean).pop() ?? path : '';
}

export function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  switch (name) {
    case 'Bash':
      return `${short(str('description') || str('command'))}`;
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `${name} ${base(i.file_path ?? i.notebook_path)}`;
    case 'Grep':
    case 'Glob':
      return `${name} ${short(str('pattern'), 40)}`;
    case 'Skill':
      return `Skill ${str('skill')}`;
    case 'Agent':
    case 'Task':
      return `Agent ${short(str('description'), 50)}`;
    case 'TaskUpdate':
    case 'TaskCreate':
      return short(str('subject') || str('activeForm') || name);
    default:
      return name.replace(/^mcp__[^_]+__/, '');
  }
}

export function activityOf(jsonl: string): Activity | null {
  let last: Activity | null = null;
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
      const at = Date.parse(entry.timestamp ?? '') || 0;
      for (const part of entry.message.content) {
        if (part?.type === 'tool_use') last = { text: describeTool(part.name, part.input), at };
        else if (part?.type === 'text' && part.text?.trim()) last = { text: short(part.text), at };
      }
    } catch {
      continue;
    }
  }
  return last;
}

export function verdictOf(texts: string[]): Verdict | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const lines = texts[i].split('\n').reverse();
    for (const line of lines) {
      const m = /^\s*`?TINKER (DONE|PARKED)\s*(.*?)`?\s*$/.exec(line);
      if (m) return { kind: m[1] as Verdict['kind'], text: m[2] };
    }
  }
  return null;
}

const STATUS = /^\s*`?tinker-status:\s*(green|awaiting-approval|ci-failing|blocked)\b[\s:—–-]*(.*?)`?\s*$/i;

/** The `tinker-status:` line of the worker's latest final message; a TINKER line without one beside it means none. */
export function statusOf(texts: string[]): Status | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const lines = texts[i].split('\n');
    for (const line of lines) {
      const m = STATUS.exec(line);
      if (m) return { kind: m[1].toLowerCase() as StatusKind, text: m[2] };
    }
    if (verdictOf([texts[i]])) return null;
  }
  return null;
}

const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'HEAD']);

/** The branch the worker last worked on: every transcript entry records gitBranch. Null on a default branch. */
export function branchOf(jsonl: string): string | null {
  const all = [...jsonl.matchAll(/"gitBranch":"([^"]+)"/g)];
  const b = all.at(-1)?.[1] ?? null;
  return b && !DEFAULT_BRANCHES.has(b) ? b : null;
}

type Read = { verdict: Verdict | null; said: string[]; activity: Activity | null; status: Status | null; branch: string | null };

export function transcript(s: Session): Read {
  const none: Read = { verdict: null, said: [], activity: null, status: null, branch: null };
  const path = transcriptPath(s);
  if (!path) return none;
  try {
    const jsonl = tail(path);
    const texts = assistantTexts(jsonl);
    return { verdict: verdictOf(texts), said: texts.slice(-6), activity: activityOf(jsonl), status: statusOf(texts), branch: branchOf(jsonl) };
  } catch {
    return none;
  }
}

export function labelOf(name: string): string {
  return name.startsWith(TAG) ? name.slice(TAG.length).trim() : name;
}
