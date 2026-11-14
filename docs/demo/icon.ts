#!/usr/bin/env bun
// The plugin's listing icon: the TUI's pixel octopus (tui/brand.ts) on a 20×20 grid, padded so a rounded or circular crop keeps it whole, written
// as SVG and rasterised to the square PNG the plugin directory asks for. Regenerate from the
// repository root (needs rsvg-convert):
//
//   bun docs/demo/icon.ts

import { OCTOPUS, PAL } from '../../tui/brand';

const GRID = 20;
const PX = 52;
const SIZE = GRID * PX; // 1040: whole pixels, inside the 512–2048 the directory accepts
const BG = '#0B1220';

const x0 = (GRID - OCTOPUS[0].length) / 2;
const y0 = (GRID - OCTOPUS.length) / 2; // the grid's last row is blank, so this sits optically centred
const rects = OCTOPUS.flatMap((line, y) =>
  [...line].flatMap((ch, x) =>
    PAL[ch] ? [`<rect x="${(x0 + x) * PX}" y="${(y0 + y) * PX}" width="${PX}" height="${PX}" fill="${PAL[ch]}"/>`] : []
  )
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" shape-rendering="crispEdges">
<title>Little Tinker</title>
<rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
${rects.join('\n')}
</svg>
`;

await Bun.write('assets/icon.svg', svg);
const png = Bun.spawnSync(['rsvg-convert', '-w', String(SIZE), '-h', String(SIZE), 'assets/icon.svg', '-o', '.claude-plugin/icon.png']);
if (png.exitCode !== 0) throw new Error(`rsvg-convert failed: ${png.stderr.toString()}`);
console.log(`assets/icon.svg, .claude-plugin/icon.png ${SIZE}×${SIZE}`);
