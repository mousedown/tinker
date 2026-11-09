/**
 * The machine the workers run on, as PullBot's view shows it: CPU, load, memory
 * and swap, and free disk. Parsing and thresholds follow PullBot's `tui/machine.ts`.
 */

import { execFile } from 'child_process';
import { cpus, freemem, homedir, loadavg, platform, totalmem } from 'os';
import { promisify } from 'util';

const run = promisify(execFile);
const MB = 1_048_576;

export type Level = 'ok' | 'warn' | 'critical';

export interface MachineView {
  /** 0–1, over the last sample; null until there are two samples. */
  cpu: number | null;
  load1: number;
  cores: number;
  mem: { totalMb: number; usedMb: number; availableMb: number };
  swapUsedMb: number | null;
  /** Free space where the checkouts live. */
  disk: { freeMb: number; totalMb: number } | null;
}

/** Same as Portia's: when a figure turns amber, and when it turns red. */
export const THRESHOLDS = {
  memFloorShare: 0.1,
  memCriticalShare: 0.5,
  diskWarnShare: 0.1,
  diskWarnMb: 10 * 1024,
  diskCriticalShare: 0.05,
  diskCriticalMb: 5 * 1024,
  loadWarn: 1.5,
  loadCritical: 2,
};

export function memLevel(availableMb: number, totalMb: number): Level {
  const floor = totalMb * THRESHOLDS.memFloorShare;
  if (availableMb < floor * THRESHOLDS.memCriticalShare) return 'critical';
  return availableMb < floor ? 'warn' : 'ok';
}

export function loadLevel(load1: number, cores: number): Level {
  const per = load1 / Math.max(1, cores);
  if (per > THRESHOLDS.loadCritical) return 'critical';
  return per > THRESHOLDS.loadWarn ? 'warn' : 'ok';
}

export function diskLevel(freeMb: number, totalMb: number): Level {
  const share = totalMb > 0 ? freeMb / totalMb : 1;
  if (share < THRESHOLDS.diskCriticalShare || freeMb < THRESHOLDS.diskCriticalMb) {
    return 'critical';
  }
  return share < THRESHOLDS.diskWarnShare || freeMb < THRESHOLDS.diskWarnMb ? 'warn' : 'ok';
}

/**
 * macOS `vm_stat`: free, inactive and speculative pages are all handed back on
 * demand without swapping, so they count as available. `os.freemem()` counts
 * only the first, which sits near zero on any Mac that has been up a while.
 */
export function parseVmStat(out: string): number | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(out)?.[1]);
  const pages = (label: string) =>
    Number(new RegExp(`^Pages ${label}:\\s+(\\d+)\\.`, 'm').exec(out)?.[1]);
  const total = pages('free') + pages('inactive') + pages('speculative');
  return Number.isFinite(pageSize) && Number.isFinite(total) ? (total * pageSize) / MB : null;
}

/** `vm.swapusage: total = 2048.00M  used = 1203.50M  free = 844.50M  (encrypted)`. */
export function parseSwapusage(text: string): number | null {
  const m = /used = ([\d.]+)([KMG])/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'G' ? n * 1024 : m[2] === 'K' ? n / 1024 : n;
}

/** `df -k <path>`: the second line's 1K-blocks and available columns. */
export function parseDf(out: string): { freeMb: number; totalMb: number } | null {
  const cols = out.trim().split('\n')[1]?.trim().split(/\s+/);
  const total = Number(cols?.[1]);
  const free = Number(cols?.[3]);
  return Number.isFinite(total) && Number.isFinite(free)
    ? { freeMb: free / 1024, totalMb: total / 1024 }
    : null;
}

interface Ticks {
  idle: number;
  total: number;
}

function ticks(): Ticks {
  return cpus().reduce(
    (sum, c) => {
      const t = c.times;
      return {
        idle: sum.idle + t.idle,
        total: sum.total + t.user + t.nice + t.sys + t.idle + t.irq,
      };
    },
    { idle: 0, total: 0 }
  );
}

const text = (command: string, args: string[]) =>
  run(command, args, { timeout: 3_000, maxBuffer: 8 * 1024 * 1024 }).then(
    (r) => r.stdout,
    () => ''
  );

/** Takes one reading each call; the disk is re-read at most every ten seconds. */
export function machineSampler(dir = homedir()) {
  let last: Ticks | null = null;
  let disk: MachineView['disk'] = null;
  let diskAt = 0;

  return async function sample(): Promise<MachineView> {
    const now = ticks();
    const cpu =
      last && now.total > last.total ? 1 - (now.idle - last.idle) / (now.total - last.total) : null;
    last = now;

    const darwin = platform() === 'darwin';
    const [vm, swap] = await Promise.all([
      darwin ? text('vm_stat', []) : Promise.resolve(''),
      darwin ? text('sysctl', ['vm.swapusage']) : Promise.resolve(''),
    ]);
    if (Date.now() - diskAt > 10_000) {
      disk = parseDf(await text('df', ['-k', dir]));
      diskAt = Date.now();
    }

    const totalMb = totalmem() / MB;
    const availableMb = Math.min(totalMb, (darwin && parseVmStat(vm)) || freemem() / MB);
    return {
      cpu,
      load1: loadavg()[0],
      cores: cpus().length,
      mem: { totalMb, availableMb, usedMb: totalMb - availableMb },
      swapUsedMb: darwin ? parseSwapusage(swap) : null,
      disk,
    };
  };
}

/** 820M, 2.9G, 41G, 1.8T. */
export function size(mb: number): string {
  const gb = mb / 1024;
  if (gb < 1) return `${Math.round(mb)}M`;
  if (gb >= 1000) return `${(gb / 1024).toFixed(1)}T`;
  return gb < 10 ? `${gb.toFixed(1)}G` : `${Math.round(gb)}G`;
}

export function pct(f: number | null): string {
  return f === null || Number.isNaN(f)
    ? '—'
    : `${Math.max(0, Math.min(100, Math.round(f * 100)))}%`;
}
