import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** The Claude Code profile this TUI is looking at: CLAUDE_CONFIG_DIR when set, as `claude` itself reads it. */
export function claudeDir(env: Record<string, string | undefined> = process.env): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

export interface Account {
  email: string | null;
  plan: string | null;
  dir: string;
}

interface AuthStatus {
  loggedIn?: boolean;
  email?: string;
  subscriptionType?: string;
  planTier?: string;
  authMethod?: string;
  configDirectory?: string;
}

/** `max_20x` → `Max 20x`, `pro` → `Pro`. */
function planName(s: AuthStatus): string | null {
  const raw = s.planTier || s.subscriptionType;
  if (!raw) return s.authMethod && s.authMethod !== 'claude.ai' ? s.authMethod : null;
  return raw
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Reads `claude auth status` output. Null when it isn't JSON or nobody is logged in. */
export function parseAuthStatus(out: string, dir: string): Account | null {
  try {
    const s = JSON.parse(out) as AuthStatus;
    if (!s.loggedIn) return null;
    return { email: s.email ?? null, plan: planName(s), dir: s.configDirectory || dir };
  } catch {
    return null;
  }
}

export interface Limits {
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetAt: number | null;
  sevenDayResetAt: number | null;
  /** When the reading was taken. */
  at: number;
}

const pctOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dateOf = (v: unknown): number | null => (typeof v === 'string' ? Date.parse(v) || null : null);

/**
 * Plan limits as the claude-hud status line last cached them, under the profile's plugins folder.
 * Tinker never asks for them itself: that needs the profile's OAuth token. When no HUD runs, there are none.
 */
export function parseHudCache(text: string): Limits | null {
  try {
    const c = JSON.parse(text) as { data?: Record<string, unknown>; lastGoodData?: Record<string, unknown>; timestamp?: number };
    const d = c.data && (c.data.fiveHour !== undefined || c.data.sevenDay !== undefined) ? c.data : c.lastGoodData;
    if (!d) return null;
    const out: Limits = {
      fiveHour: pctOf(d.fiveHour),
      sevenDay: pctOf(d.sevenDay),
      fiveHourResetAt: dateOf(d.fiveHourResetAt),
      sevenDayResetAt: dateOf(d.sevenDayResetAt),
      at: typeof c.timestamp === 'number' ? c.timestamp : 0,
    };
    return out.fiveHour === null && out.sevenDay === null ? null : out;
  } catch {
    return null;
  }
}

export function readLimits(dir = claudeDir()): Limits | null {
  const path = join(dir, 'plugins', 'claude-hud', '.usage-cache.json');
  if (!existsSync(path)) return null;
  try {
    return parseHudCache(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Tokens a session spent: what it sent fresh, wrote to the cache, and wrote back. Cache reads are left out. */
export interface Tokens {
  input: number;
  output: number;
}

export const NO_TOKENS: Tokens = { input: 0, output: 0 };

export function total(t: Tokens): number {
  return t.input + t.output;
}

/** Sums assistant usage over whole lines, once per message id: one message is written as several entries. */
export function addUsage(lines: string, into: Tokens, seen: Set<string>): Tokens {
  let { input, output } = into;
  for (const line of lines.split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      const entry = JSON.parse(line);
      const m = entry.type === 'assistant' ? entry.message : null;
      const u = m?.usage;
      if (!u) continue;
      const id = m.id ?? entry.uuid;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      output += u.output_tokens ?? 0;
    } catch {
      continue;
    }
  }
  return { input, output };
}

interface Tally {
  offset: number;
  rest: string;
  tokens: Tokens;
  seen: Set<string>;
}

const tallies = new Map<string, Tally>();

/** A transcript's token total, reading only what was appended since the last call. */
export function tokensOf(path: string | null): Tokens {
  if (!path) return NO_TOKENS;
  let t = tallies.get(path) ?? { offset: 0, rest: '', tokens: NO_TOKENS, seen: new Set<string>() };
  try {
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      if (size < t.offset) t = { offset: 0, rest: '', tokens: NO_TOKENS, seen: new Set<string>() };
      if (size > t.offset) {
        const buf = Buffer.alloc(size - t.offset);
        readSync(fd, buf, 0, buf.length, t.offset);
        const text = t.rest + buf.toString('utf8');
        const cut = text.lastIndexOf('\n');
        t.tokens = addUsage(text.slice(0, cut + 1), t.tokens, t.seen);
        t.rest = text.slice(cut + 1);
        t.offset = size;
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    return t.tokens;
  }
  tallies.set(path, t);
  return t.tokens;
}

/** 950, 12k, 3.4M. */
export function count(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export interface AccountView {
  account: Account | null;
  limits: Limits | null;
}
