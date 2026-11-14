#!/usr/bin/env bun
// The README banner: the TUI's pixel octopus and TINKER wordmark (tui/brand.ts), with LITTLE
// set above it in the same shadowed block face, so the two words read as one lockup with a
// single gradient running through both. Regenerate from the repository root:
//
//   bun docs/demo/banner.ts

import { OCTOPUS, PAL, SKY_RAMP, WORD } from '../../tui/brand';

const PX = 10; // a terminal cell is PX wide and 2 PX tall
const CELL_H = PX * 2;
const OCTO_PX = 20; // the octopus spans both lines of the wordmark
const GAP = 3 * PX;

// LITTLE in the same ANSI Shadow face as tui/brand.ts's TINKER, letters set tight the same way.
const GLYPHS: Record<string, string[]> = {
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
};
const LITTLE = GLYPHS.L.map((_, row) => [...'LITTLE'].map((ch) => GLYPHS[ch][row]).join(''));
const LINES = [...LITTLE, ...WORD];

type Rgb = number[];
const mix = (a: Rgb, b: Rgb, t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const ramp = (t: number) => (t < 0.5 ? mix(SKY_RAMP[0], SKY_RAMP[1], t * 2) : mix(SKY_RAMP[1], SKY_RAMP[2], (t - 0.5) * 2));
const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const TENTACLES = 7; // rows of OCTOPUS from here down sway
const isEye = (ch: string) => ch === 'W' || ch === 'K';

function octopus(y0: number): string {
  const body: string[] = [];
  const arms: string[] = [];
  const lids: string[] = [];
  const cell = (x: number, y: number, fill: string) =>
    `<rect x="${x * OCTO_PX}" y="${y0 + y * OCTO_PX}" width="${OCTO_PX}" height="${OCTO_PX}" fill="${fill}"/>`;
  OCTOPUS.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      const fill = PAL[ch];
      if (!fill) return;
      (y >= TENTACLES ? arms : body).push(cell(x, y, fill));
      if (isEye(ch)) lids.push(cell(x, y, PAL.B));
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
  LINES.forEach((line, row) => {
    const face = ramp(row / (LINES.length - 1));
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

const octoW = OCTOPUS[0].length * OCTO_PX;
const wordW = Math.max(...LINES.map((l) => l.trimEnd().length)) * PX;
const wordH = LINES.length * CELL_H;
const octoH = (OCTOPUS.length - 1) * OCTO_PX; // the grid's last row is blank
const width = octoW + GAP + wordW;
const height = Math.max(octoH, wordH);

const style = `
  .arms { transform-box: fill-box; transform-origin: 50% 0; animation: sway 1.2s steps(1) infinite; }
  .lids { opacity: 0; animation: blink 4.5s steps(1) infinite; }
  @keyframes sway { 0% { transform: skewX(-7deg); } 50% { transform: skewX(7deg); } }
  @keyframes blink { 0%, 92% { opacity: 0; } 93%, 96% { opacity: 1; } 97% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .arms, .lids { animation: none; } }
`;

await Bun.write(
  'assets/banner.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -8 ${width + 24} ${height + 16}" width="${width + 24}" height="${height + 16}" shape-rendering="crispEdges" role="img">
<title>Little Tinker</title>
<style>${style}</style>
${octopus((height - octoH) / 2)}
${wordmark(octoW + GAP)}
</svg>
`
);
console.log(`assets/banner.svg ${width}×${height}`);
