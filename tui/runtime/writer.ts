/** Writes a frame by overwriting, never clearing, so the screen does not flicker. */

const ESC = '\x1b[';
const SYNC_ON = `${ESC}?2026h`;
const SYNC_OFF = `${ESC}?2026l`;

/**
 * What to write to turn the screen from `prev` into `next`: only the rows that
 * changed, inside a synchronised update. A first frame, or one of a different
 * height, is drawn whole from the top.
 */
export function diffFrame(prev: string[] | null, next: string[]): string {
  if (!prev || prev.length !== next.length) {
    return `${SYNC_ON}${ESC}H${next.map((line) => `${line}${ESC}K`).join('\r\n')}${ESC}J${SYNC_OFF}`;
  }

  let out = '';
  next.forEach((line, i) => {
    if (line !== prev[i]) out += `${ESC}${i + 1};1H${line}${ESC}K`;
  });
  return out ? `${SYNC_ON}${out}${SYNC_OFF}` : '';
}
