import { claudeDir, count, type AccountView } from './account';
import { diskLevel, loadLevel, memLevel, pct, size, type Level, type MachineView } from './machine';
import type { Seg } from './render/text';
import { AMBER, DIM, INK, INK2, RED } from './render/theme';

function role(level: Level): string {
  return level === 'critical' ? RED : level === 'warn' ? AMBER : INK2;
}

function flagged(text: string, level: Level): string {
  return level === 'ok' ? text : `▲${text}`;
}

export function meter(frac: number, w: number, sgr: string): Seg[] {
  const full = Math.round(Math.min(1, Math.max(0, frac)) * w);
  return [
    ['━'.repeat(full), sgr],
    ['─'.repeat(w - full), DIM],
  ];
}

export const GAUGE_WIDTH = 12;

export function machineStrip(m: MachineView | null): Seg[] {
  if (!m) return [];
  const load = loadLevel(m.load1, m.cores);
  const mem = memLevel(m.mem.availableMb, m.mem.totalMb);
  const share = m.mem.usedMb / Math.max(1, m.mem.totalMb);
  const disk = m.disk ? diskLevel(m.disk.freeMb, m.disk.totalMb) : null;
  const room = m.capacity?.room ?? null;
  return [
    ...meter(share, GAUGE_WIDTH, role(mem)),
    ['  mem ', DIM],
    [flagged(pct(share), mem), role(mem)],
    [` ${size(m.mem.usedMb)}/${size(m.mem.totalMb)}`, role(mem)],
    ...(room === null ? [] : ([[` · room for ${room} (~${size(m.capacity!.perSessionMb)} each)`, room === 0 ? AMBER : DIM]] as Seg[])),
    ...(m.swapUsedMb ? ([[` · swap ${size(m.swapUsedMb)}`, DIM]] as Seg[]) : []),
    [' · cpu ', DIM],
    [flagged(pct(m.cpu), load), role(load)],
    [' · load ', DIM],
    [m.load1.toFixed(1), role(load)],
    [`/${m.cores}`, DIM],
    ...(m.disk && disk
      ? ([
          [' · disk ', DIM],
          [flagged(`${size(m.disk.freeMb)} free`, disk), role(disk)],
        ] as Seg[])
      : []),
  ];
}

function limitRole(p: number): string {
  return p >= 90 ? RED : p >= 70 ? AMBER : INK2;
}

/** 00:10 within the day, Wed 09:00 beyond it. */
export function resetAt(at: number, now: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return at - now < 24 * 60 * 60 * 1000 ? hm : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`;
}

const STALE_LIMITS_MS = 15 * 60 * 1000;

/** `~/.claude-work2` → `claude-work2`: the profile, by the name its folder gives it. */
export function profileName(dir: string): string {
  return (dir.split('/').filter(Boolean).pop() ?? dir).replace(/^\./, '');
}

/** Who Tinker runs as: the account, its plan and the profile. */
export function identity(v: AccountView | null): Seg[] {
  if (!v) return [];
  const a = v.account;
  return [
    ['◉ ', DIM],
    a?.email ? [a.email, INK] : ['not logged in', AMBER],
    ...(a?.plan ? ([[` · ${a.plan}`, INK2]] as Seg[]) : []),
    [` · ${profileName(a?.dir ?? claudeDir())}`, DIM],
  ];
}

/** What the plan has left, and what Tinker's sessions have spent. Empty when there is neither. */
export function usageStrip(v: AccountView | null, tokens: number, now: number): Seg[] {
  const out: Seg[] = [];
  const add = (segs: Seg[]) => {
    if (out.length) out.push([' · ', DIM]);
    out.push(...segs);
  };
  const l = v?.limits;
  if (l) {
    const stale = now - l.at > STALE_LIMITS_MS;
    const limit = (label: string, p: number | null, reset: number | null) => {
      if (p === null) return;
      const sgr = stale ? DIM : limitRole(p);
      add([
        ...meter(p / 100, 8, sgr),
        [`  ${label} `, DIM],
        [`${Math.round(p)}%`, sgr],
        ...(reset && reset > now ? ([[` ↺ ${resetAt(reset, now)}`, DIM]] as Seg[]) : []),
      ]);
    };
    limit('5h', l.fiveHour, l.fiveHourResetAt);
    limit('week', l.sevenDay, l.sevenDayResetAt);
    if (stale && l.at && out.length) out.push([` (read ${Math.round((now - l.at) / 60000)}m ago)`, DIM]);
  }
  if (tokens) add([['tinker ', DIM], [`${count(tokens)} tokens`, INK2]]);
  return out;
}
