import { diskLevel, loadLevel, memLevel, pct, size, type Level, type MachineView } from './machine';
import type { Seg } from './render/text';
import { AMBER, DIM, INK2, RED } from './render/theme';

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
  return [
    ...meter(share, GAUGE_WIDTH, role(mem)),
    ['  mem ', DIM],
    [flagged(pct(share), mem), role(mem)],
    [` ${size(m.mem.usedMb)}/${size(m.mem.totalMb)}`, role(mem)],
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
