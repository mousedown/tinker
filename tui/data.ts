import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const TAG = '🐙';

export type SessionState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped' | string;

export interface Session {
  id: string;
  sessionId: string;
  cwd: string;
  state: SessionState;
  startedAt: number;
  name: string;
}

export type Ci = 'pass' | 'fail' | 'pending' | 'none';

export interface Checks {
  pass: number;
  fail: number;
  pending: number;
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

export interface Row extends Session {
  key: string | null;
  label: string;
  pr: Pr | null;
  verdict: Verdict | null;
  said: string[];
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

export function countChecks(checks: GhCheck[] | null): Checks {
  const out: Checks = { pass: 0, fail: 0, pending: 0 };
  for (const c of checks ?? []) {
    const r = resultOf(c);
    if (FAILED.includes(r)) out.fail++;
    else if (PASSED.includes(r)) out.pass++;
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

export async function pulls(cwd: string): Promise<Pr[]> {
  if (!existsSync(cwd)) return [];
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
    return [];
  }
}

export function prFor(key: string | null, prs: Pr[], verdict: Verdict | null): Pr | null {
  const fromVerdict = verdict && /\/pull\/(\d+)/.exec(verdict.text)?.[1];
  if (fromVerdict) {
    const hit = prs.find((p) => p.number === Number(fromVerdict));
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

export function transcript(s: Session): { verdict: Verdict | null; said: string[] } {
  const path = transcriptPath(s);
  if (!path) return { verdict: null, said: [] };
  try {
    const texts = assistantTexts(tail(path));
    return { verdict: verdictOf(texts), said: texts.slice(-6) };
  } catch {
    return { verdict: null, said: [] };
  }
}

export function labelOf(name: string): string {
  return name.startsWith(TAG) ? name.slice(TAG.length).trim() : name;
}
