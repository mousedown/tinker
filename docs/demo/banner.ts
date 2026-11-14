#!/usr/bin/env bun
// The README banner, drawn from the same pixel grids the TUI paints its header with
// (tui/brand.ts), so the two never drift. Regenerate from the repository root:
//
//   bun docs/demo/banner.ts

import { OCTOPUS, PAL, SKY_RAMP, WORD } from '../../tui/brand';

const PX = 10; // one octopus pixel; a terminal cell is PX wide and 2 PX tall
const CELL_H = PX * 2;
const GAP = 2 * PX;

type Rgb = number[];
const mix = (a: Rgb, b: Rgb, t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const ramp = (t: number) => (t < 0.5 ? mix(SKY_RAMP[0], SKY_RAMP[1], t * 2) : mix(SKY_RAMP[1], SKY_RAMP[2], (t - 0.5) * 2));
const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const TENTACLES = 7; // rows of OCTOPUS from here down sway
const isEye = (ch: string) => ch === 'W' || ch === 'K';

function octopus(): string {
  const body: string[] = [];
  const arms: string[] = [];
  const lids: string[] = [];
  OCTOPUS.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      const fill = PAL[ch];
      if (!fill) return;
      const rect = `<rect x="${x * PX}" y="${y * PX}" width="${PX}" height="${PX}" fill="${fill}"/>`;
      (y >= TENTACLES ? arms : body).push(rect);
      if (isEye(ch)) lids.push(`<rect x="${x * PX}" y="${y * PX}" width="${PX}" height="${PX}" fill="${PAL.B}"/>`);
    })
  );
  return `<g>${body.join('')}</g><g class="arms">${arms.join('')}</g><g class="lids">${lids.join('')}</g>`;
}

// The wordmark's double-line shadow, drawn the way a terminal draws ═ ║ ╔ ╗ ╚ ╝.
function shadow(ch: string, x0: number, y0: number): string {
  const [cx, cy, o, ox] = [x0 + PX / 2, y0 + CELL_H / 2, 3, 2];
  const [l, r, t, b] = [x0, x0 + PX, y0, y0 + CELL_H];
  const paths: Record<string, string[]> = {
    '═': [`M${l} ${cy - o}H${r}`, `M${l} ${cy + o}H${r}`],
    '║': [`M${cx - ox} ${t}V${b}`, `M${cx + ox} ${t}V${b}`],
    '╗': [`M${l} ${cy - o}H${cx + ox}V${b}`, `M${l} ${cy + o}H${cx - ox}V${b}`],
    '╔': [`M${r} ${cy - o}H${cx - ox}V${b}`, `M${r} ${cy + o}H${cx + ox}V${b}`],
    '╝': [`M${l} ${cy + o}H${cx + ox}V${t}`, `M${l} ${cy - o}H${cx - ox}V${t}`],
    '╚': [`M${r} ${cy + o}H${cx - ox}V${t}`, `M${r} ${cy - o}H${cx + ox}V${t}`],
  };
  return (paths[ch] ?? []).join('');
}

function wordmark(x0: number): string {
  const out: string[] = [];
  WORD.forEach((line, row) => {
    const face = ramp(row / (WORD.length - 1));
    const dark = hex(face.map((v) => Math.round(v * 0.55)));
    let d = '';
    [...line].forEach((ch, col) => {
      const x = x0 + col * PX;
      const y = row * CELL_H;
      if (ch === '█') out.push(`<rect x="${x}" y="${y}" width="${PX + 0.5}" height="${CELL_H + 0.5}" fill="${hex(face)}"/>`);
      else d += shadow(ch, x, y);
    });
    if (d) out.push(`<path d="${d}" fill="none" stroke="${dark}" stroke-width="1.6"/>`);
  });
  return out.join('');
}

const octoW = OCTOPUS[0].length * PX;
const width = octoW + GAP + WORD[0].length * PX;
const height = Math.max(OCTOPUS.length * PX, WORD.length * CELL_H);

const style = `
  .arms { transform-box: fill-box; transform-origin: 50% 0; animation: sway 1.2s steps(1) infinite; }
  .lids { opacity: 0; animation: blink 4.5s steps(1) infinite; }
  @keyframes sway { 0% { transform: skewX(-7deg); } 50% { transform: skewX(7deg); } }
  @keyframes blink { 0%, 92% { opacity: 0; } 93%, 96% { opacity: 1; } 97% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .arms, .lids { animation: none; } }
`;

const svg = (w: number, body: string, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -4 ${w + 24} ${height + 8}" width="${w + 24}" height="${height + 8}" shape-rendering="crispEdges" role="img">
<title>${title}</title>
<style>${style}</style>
${body}
</svg>
`;

await Bun.write('assets/banner.svg', svg(width, octopus() + wordmark(octoW + GAP), 'Little Tinker'));
console.log(`assets/banner.svg ${width}×${height}`);
