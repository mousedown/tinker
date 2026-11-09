import type { Seg } from './render/text';
import { DIM, bg, fg } from './render/theme';

const PAL: Record<string, string> = {
  B: '#F59E0B',
  b: '#B45309',
  H: '#FDE68A',
  W: '#F0F9FF',
  K: '#0B1220',
};

const OCTOPUS = [
  '....BBBBBB....',
  '..BBHHBBBBBB..',
  '.BBHBBBBBBBBB.',
  '.BBWWBBBBWWBB.',
  '.BBWKBBBBWKBB.',
  '.BBBBBBBBBBBb.',
  '..bBBBBBBBBb..',
  '.BB.BB..BB.BB.',
  '.BB.BB..BB.BB.',
  'BB..BB..BB..BB',
  'B..BB....BB..B',
  '..............',
];

const MINI_OCTOPUS = ['.BBBB.', 'BWBBWB', 'BBBBBB', 'B.BB.B'];

const WORD = [
  '████████╗██╗███╗   ██╗██╗  ██╗███████╗██████╗ ',
  '╚══██╔══╝██║████╗  ██║██║ ██╔╝██╔════╝██╔══██╗',
  '   ██║   ██║██╔██╗ ██║█████╔╝ █████╗  ██████╔╝',
  '   ██║   ██║██║╚██╗██║██╔═██╗ ██╔══╝  ██╔══██╗',
  '   ██║   ██║██║ ╚████║██║  ██╗███████╗██║  ██║',
  '   ╚═╝   ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝',
];

export const LOGO_ROWS = OCTOPUS.length / 2;

type Rgb = [number, number, number];

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  a.map((v, i) => Math.round(v + (b[i] - v) * t)) as Rgb;
const ramp = ([a, b, c]: Rgb[], t: number): Rgb =>
  t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2);

export const SKY_RAMP = ['#7DD3FC', '#0EA5E9', '#0369A1'].map(hex);

function colour([r, g, b]: Rgb): string {
  const six = (v: number) => Math.round((v / 255) * 5);
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return fg(`#${toHex(r)}${toHex(g)}${toHex(b)}`, 16 + 36 * six(r) + 6 * six(g) + six(b));
}

function rgbHex(h: string): Rgb {
  return hex(h);
}

function cube([r, g, b]: Rgb): number {
  const six = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * six(r) + 6 * six(g) + six(b);
}

function pixelRow(grid: string[], row: number): Seg[] {
  const top = grid[row * 2];
  const bottom = grid[row * 2 + 1] ?? '';
  return [...top].map((_, x): Seg => {
    const t = PAL[top[x]];
    const u = PAL[bottom[x] ?? '.'];
    if (!t && !u) return [' ', null];
    if (t && !u) return ['▀', fg(t, cube(rgbHex(t)))];
    if (!t && u) return ['▄', fg(u, cube(rgbHex(u)))];
    if (t === u) return ['█', fg(t!, cube(rgbHex(t!)))];
    return ['▀', `${fg(t!, cube(rgbHex(t!)))};${bg(u!, cube(rgbHex(u!)))}`];
  });
}

function wordRow(line: string, r: number): Seg[] {
  const face = ramp(SKY_RAMP, r / (WORD.length - 1));
  const shadow = face.map((v) => Math.round(v * 0.55)) as Rgb;
  return [...line].map((ch): Seg => [ch, colour('█▄▀'.includes(ch) ? face : shadow)]);
}

function runs(segs: Seg[]): Seg[] {
  return segs.reduce<Seg[]>((out, seg) => {
    const last = out[out.length - 1];
    if (last && last[1] === seg[1]) out[out.length - 1] = [last[0] + seg[0], seg[1]];
    else out.push(seg);
    return out;
  }, []);
}

export const LOGO_WIDTH = OCTOPUS[0].length + 2 + WORD[0].length;

export function logo(width = Infinity): Seg[][] {
  const octopus = width >= LOGO_WIDTH;
  return WORD.map((line, r): Seg[] =>
    runs([...(octopus ? [...pixelRow(OCTOPUS, r), ['  ', null] as Seg] : []), ...wordRow(line, r)])
  );
}

const MINI_WORD = ['▀█▀ █ █▄ █ █▄▀ █▀▀ █▀█', ' █  █ █ ▀█ █ █ ██▄ █▀▄'];

export const MINI_WIDTH = MINI_OCTOPUS[0].length + 1 + MINI_WORD[0].length + 3;

export function miniLogo(): Seg[][] {
  return [0, 1].map((r): Seg[] =>
    runs([
      ...pixelRow(MINI_OCTOPUS, r),
      [' ', null],
      [MINI_WORD[r], colour(ramp(SKY_RAMP, r * 0.6))],
      ['   ', null],
    ])
  );
}

export const TAGLINE: Seg[] = [['Little Tinker • fixes issues as native background sessions', DIM]];
