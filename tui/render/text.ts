/**
 * Terminal cell arithmetic. A line is a list of segments, each a run of text
 * with the SGR parameters it is drawn in. Widths count terminal cells, so a
 * wide character such as 🌿 counts two and is never split.
 */

/** Text, its SGR, and optionally a URL it links to (an OSC 8 hyperlink). */
export type Seg = [text: string, sgr: string | null, link?: string];

const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f2ff],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
];

const ZERO: [number, number][] = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0x2060, 0x2064],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0x1f3fb, 0x1f3ff],
  [0xe0100, 0xe01ef],
];

function inRanges(cp: number, ranges: [number, number][]): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x300) return 1;
  if (inRanges(cp, ZERO)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}

export function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width;
}

/** At most `width` cells, ending in `…` when anything was cut. */
export function cut(text: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return '';
  if (cellWidth(text) <= width) return text;
  const room = width - cellWidth(ellipsis);
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = charWidth(ch);
    if (used + w > room) break;
    out += ch;
    used += w;
  }
  return out + ellipsis;
}

/** Left-aligned in exactly `width` cells. */
export function pad(text: string, width: number): string {
  const fitted = cut(text, width);
  return fitted + ' '.repeat(Math.max(0, width - cellWidth(fitted)));
}

/** Right-aligned in exactly `width` cells. */
export function rpad(text: string, width: number): string {
  const fitted = cut(text, width);
  return ' '.repeat(Math.max(0, width - cellWidth(fitted))) + fitted;
}

/** Word-wrapped to `width` cells; a word longer than a line is broken. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (cellWidth(rest) > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        let head = '';
        for (const ch of rest) {
          if (cellWidth(head + ch) > width) break;
          head += ch;
        }
        lines.push(head);
        rest = rest.slice(head.length);
      }
      if (!rest) continue;
      if (!line) line = rest;
      else if (cellWidth(line) + 1 + cellWidth(rest) <= width) line += ` ${rest}`;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function segsWidth(segs: Seg[]): number {
  return segs.reduce((sum, [text]) => sum + cellWidth(text), 0);
}

/** Segments cut to at most `width` cells, ending in `…` when anything was cut. */
export function truncate(segs: Seg[], width: number): Seg[] {
  if (segsWidth(segs) <= width) return segs;
  const out: Seg[] = [];
  let room = width;
  for (const [text, sgr, link] of segs) {
    const w = cellWidth(text);
    if (w < room) {
      out.push(link ? [text, sgr, link] : [text, sgr]);
      room -= w;
      continue;
    }
    const kept = w > room ? cut(text, room) : `${cut(text, room - 1, '')}…`;
    out.push(link ? [kept, sgr, link] : [kept, sgr]);
    break;
  }
  return out;
}

// eslint-disable-next-line no-control-regex
const SGR_SEQ = /\x1b\[[0-9;?]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const OSC_SEQ = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(OSC_SEQ, '').replace(SGR_SEQ, '');
}
