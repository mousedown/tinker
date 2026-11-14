/**
 * How many more sessions the machine can take. A session's footprint is its process tree's resident
 * memory: the claude process plus everything it started (builds, test runners, dev servers). The peak
 * each session reaches is kept for a week in ~/.cache/tinker/peaks, which `bin/tinker` reads and
 * writes the same way, so the TUI (sampling every couple of seconds) teaches the launcher what a
 * build costs.
 *
 *   per session = the largest peak this week, kept between FLOOR_MB and CEIL_MB (DEFAULT_MB with none)
 *   held back   = for each working session, what it may still grow by to reach that
 *   room        = (available − 10% reserve − held back) / per session
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { THRESHOLDS } from './machine';

export const DEFAULT_MB = 2048;
export const FLOOR_MB = 1024;
export const CEIL_MB = 8192;
export const WINDOW_S = 7 * 24 * 3600;

export interface Live {
  id: string;
  pid?: number | null;
  state: string;
}

/** Session id → its peak, in MB, and when that was last seen (epoch seconds). */
export type Peaks = Map<string, { at: number; mb: number }>;

export interface Capacity {
  room: number;
  perSessionMb: number;
  heldBackMb: number;
  /** True when the figure comes from what sessions actually used, not the default or an override. */
  learned: boolean;
}

export function peaksPath(env: Record<string, string | undefined> = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'tinker', 'peaks');
}

/** `ps -A -o pid=,ppid=,rss=` → pid → [ppid, rss KB]. */
export function parsePs(out: string): Map<number, [number, number]> {
  const procs = new Map<number, [number, number]>();
  for (const line of out.split('\n')) {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
    if (Number.isFinite(pid) && Number.isFinite(ppid) && Number.isFinite(rss)) procs.set(pid!, [ppid!, rss!]);
  }
  return procs;
}

/** Resident memory of a process and all its descendants, in MB; null when it isn't running. */
export function treeMb(procs: Map<number, [number, number]>, root: number): number | null {
  if (!procs.has(root)) return null;
  const children = new Map<number, number[]>();
  for (const [pid, [ppid]] of procs) {
    if (pid !== ppid) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  let kb = 0;
  const stack = [root];
  const seen = new Set<number>();
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    kb += procs.get(pid)?.[1] ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return kb / 1024;
}

export function parsePeaks(text: string, now: number): Peaks {
  const peaks: Peaks = new Map();
  for (const line of text.split('\n')) {
    const [id, at, mb] = line.trim().split(/\s+/);
    const t = Number(at);
    const m = Number(mb);
    if (id && Number.isFinite(t) && Number.isFinite(m) && now - t <= WINDOW_S) peaks.set(id, { at: t, mb: m });
  }
  return peaks;
}

export function formatPeaks(peaks: Peaks): string {
  return [...peaks].map(([id, p]) => `${id} ${p.at} ${Math.round(p.mb)}\n`).join('');
}

/** Raises each running session's peak to what it uses now. Returns what each uses now. */
export function record(peaks: Peaks, live: Live[], procs: Map<number, [number, number]>, now: number): Map<string, number> {
  const using = new Map<string, number>();
  for (const s of live) {
    if (!s.pid) continue;
    const mb = treeMb(procs, s.pid);
    if (mb === null) continue;
    using.set(s.id, mb);
    const old = peaks.get(s.id);
    peaks.set(s.id, { at: now, mb: Math.max(mb, old?.mb ?? 0) });
  }
  return using;
}

/**
 * `override` is TINKER_SESSION_MB: a fixed figure, or 0 to turn the check off (null is returned).
 */
export function capacity(
  availableMb: number,
  totalMb: number,
  peaks: Peaks,
  live: Live[],
  using: Map<string, number>,
  override?: number
): Capacity | null {
  if (override !== undefined && !(override > 0)) return null;
  const top = Math.max(0, ...[...peaks.values()].map((p) => p.mb));
  const learned = override === undefined && top > 0;
  const perSessionMb =
    override !== undefined ? override : learned ? Math.min(CEIL_MB, Math.max(FLOOR_MB, top)) : DEFAULT_MB;
  const heldBackMb = live
    .filter((s) => s.state === 'working')
    .reduce((sum, s) => sum + Math.max(0, perSessionMb - (using.get(s.id) ?? perSessionMb)), 0);
  const free = availableMb - totalMb * THRESHOLDS.memFloorShare - heldBackMb;
  return { room: Math.max(0, Math.floor(free / perSessionMb)), perSessionMb, heldBackMb, learned };
}

export function sessionOverride(env: Record<string, string | undefined> = process.env): number | undefined {
  const raw = env.TINKER_SESSION_MB;
  return raw === undefined || raw === '' ? undefined : Number(raw);
}

export function loadPeaks(now: number, path = peaksPath()): Peaks {
  try {
    return parsePeaks(readFileSync(path, 'utf8'), now);
  } catch {
    return new Map();
  }
}

export function savePeaks(peaks: Peaks, path = peaksPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}`;
    writeFileSync(tmp, formatPeaks(peaks));
    renameSync(tmp, path);
  } catch {
    return;
  }
}
