/** Fixed columns plus one flexible one, dropping columns in order when narrow. */

import { segsWidth, truncate, type Seg } from './text';
import { DIM } from './theme';

export interface Column {
  key: string;
  title: string;
  width: number;
  align?: 'left' | 'right';
  /** Takes the spare width, at least `width`. */
  flex?: boolean;
  /** Lower drops first when the line is too narrow; unset never drops. */
  drop?: number;
}

const GAP = 2;

/** The columns that fit in `width`, the flexible one widened to fill it. */
export function layout(columns: Column[], width: number): Column[] {
  let cols = [...columns];
  const need = (list: Column[]) =>
    list.reduce((sum, c) => sum + c.width, 0) + GAP * Math.max(0, list.length - 1);

  while (need(cols) > width) {
    const droppable = cols.filter((c) => c.drop !== undefined).sort((a, b) => a.drop! - b.drop!);
    if (droppable.length === 0) break;
    cols = cols.filter((c) => c !== droppable[0]);
  }

  const spare = Math.max(0, width - need(cols));
  return cols.map((c) => (c.flex ? { ...c, width: c.width + spare } : c));
}

/** Segments cut and padded to exactly `width` cells. */
export function fit(segs: Seg[], width: number, align: 'left' | 'right' = 'left'): Seg[] {
  const out = truncate(segs, width);
  const space: Seg = [' '.repeat(Math.max(0, width - segsWidth(out))), null];
  return align === 'right' ? [space, ...out] : [...out, space];
}

export function headerRow(columns: Column[]): Seg[] {
  return columns.flatMap((c, i): Seg[] => [
    ...(i > 0 ? ([[' '.repeat(GAP), null]] as Seg[]) : []),
    ...fit([[c.title, DIM]], c.width, c.align),
  ]);
}

export function tableRow(columns: Column[], cells: Record<string, Seg[]>): Seg[] {
  return columns.flatMap((c, i): Seg[] => [
    ...(i > 0 ? ([[' '.repeat(GAP), null]] as Seg[]) : []),
    ...fit(cells[c.key] ?? [], c.width, c.align),
  ]);
}
