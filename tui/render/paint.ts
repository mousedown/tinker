/** Turns segments into one terminal line, and builds the shared chrome. */

import { segsWidth, truncate, type Seg } from './text';
import {
  BLUE,
  BOLD,
  DIM,
  ESC,
  REVERSE,
  SELECT_BG,
  isAttribute,
  useColor,
} from './theme';

function close(sgr: string): string {
  if (sgr === BOLD || sgr === DIM) return '22';
  if (sgr === REVERSE) return '27';
  if (sgr.startsWith('48;') || /^4\d$/.test(sgr)) return '49';
  if (sgr.includes(';48;')) return '39;49';
  return '39';
}

/** `TINKER_LINKS=0` turns the hyperlinks off for a terminal that prints them. */
function links(env: Record<string, string | undefined> = process.env): boolean {
  return env.TINKER_LINKS !== '0';
}

/** OSC 8: `text` becomes a link to `url` in terminals that support it, plain text elsewhere. */
export function hyperlink(text: string, url: string): string {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/**
 * One line of at most `width` cells. Text is cut across segments with `…`.
 * Passing `selected` makes it a selectable row: a two-cell gutter holding `›`
 * when selected, and the selection tint to the end of the line. Each segment
 * closes only its own attribute, so the tint survives it.
 */
export function paint(segs: Seg[], width: number, selected?: boolean, color = useColor()): string {
  const parts: Seg[] =
    selected === undefined ? segs : [[selected ? '› ' : '  ', selected ? BOLD : null], ...segs];

  const fitted = truncate(parts, width);

  const out = fitted
    .map(([text, sgr, link]) => {
      const k = sgr && (color || isAttribute(sgr)) ? sgr : null;
      const styled = k && text ? `${ESC}${k}m${text}${ESC}${close(k)}m` : text;
      return link && text && links() ? hyperlink(styled, link) : styled;
    })
    .join('');

  if (!selected) return out;
  return color ? `${ESC}${SELECT_BG}m${out}${ESC}K${ESC}49m` : `${ESC}${REVERSE}m${out}${ESC}27m`;
}

export type Hint = [key: string, label: string];

function hintSegs(hints: Hint[]): Seg[] {
  return hints.flatMap(([key, label], i): Seg[] => [
    ...(i > 0 ? ([[' · ', DIM]] as Seg[]) : []),
    [key, BOLD],
    [` ${label}`, DIM],
  ]);
}

/**
 * The key-hint footer: `↑↓ select · enter open · …`. When it does not fit,
 * the moving keys go on one line and the acting keys after them, wrapped.
 */
export function keyLines(move: Hint[], act: Hint[], width: number): Seg[][] {
  const one = hintSegs([...move, ...act]);
  if (segsWidth(one) <= width) return [one];

  const lines: Seg[][] = [hintSegs(move)];
  let line: Hint[] = [];
  for (const hint of act) {
    if (line.length > 0 && segsWidth(hintSegs([...line, hint])) > width) {
      lines.push(hintSegs(line));
      line = [];
    }
    line.push(hint);
  }
  if (line.length > 0) lines.push(hintSegs(line));
  return lines;
}

/** `🐙 tinker › sessions`: the brand, dim steps, the last one bold. */
export function crumbs(steps: string[]): Seg[] {
  const segs: Seg[] = [
    ['🐙 ', null],
    ['tinker', BLUE],
  ];
  steps.forEach((step, i) => {
    segs.push([' › ', DIM]);
    segs.push([step, i === steps.length - 1 ? BOLD : DIM]);
  });
  return segs;
}
