/**
 * The palette: warm greys, a sky accent with brass, and status colours picked for
 * contrast on a dark terminal. Truecolor when the terminal says so (`COLORTERM=truecolor`,
 * as Ghostty does), 256 colours otherwise.
 * `NO_COLOR` keeps bold, dim and reverse only.
 */

export const ESC = '\x1b[';

export const BOLD = '1';
export const DIM = '2';
export const REVERSE = '7';

export function truecolor(env: Record<string, string | undefined> = process.env): boolean {
  return env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit';
}

const TRUECOLOR = truecolor();

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}

/** A foreground colour: `hex` in truecolor, the 256-colour index otherwise. */
export function fg(hex: string, c256: number, deep = TRUECOLOR): string {
  return deep ? `38;2;${rgb(hex)}` : `38;5;${c256}`;
}

export function bg(hex: string, c256: number, deep = TRUECOLOR): string {
  return deep ? `48;2;${rgb(hex)}` : `48;5;${c256}`;
}

/** Body text, in warm greys. */
export const INK = fg('#E8E4DC', 254);
/** Secondary text. */
export const INK2 = fg('#ABA597', 248);
/** The accent: selections and what to act on. */
export const SKY = fg('#7DD3FC', 117);
export const BLUE = fg('#0EA5E9', 39);
/** Waiting on you: the wrench's brass. */
export const BRASS = fg('#FBBF24', 214);
export const AMBER = fg('#F59E0B', 208);
/** Running. */
export const SPROUT = fg('#7DD3FC', 117);
export const GREEN = fg('#10B981', 36);
export const RED = fg('#F0787A', 210);
export const MAGENTA = fg('#D3A0E6', 183);
export const PEACH = SKY;
export const YELLOW = BRASS;
/** The wordmark's mid blue, for the breadcrumb. */
export const ORANGE = BLUE;

/** A cool slate selection tint; every status colour keeps 4.5:1 on it. `TINKER_SELECT_BG` takes a 256-colour index. */
export const SELECT_BG = /^\d{1,3}$/.test(process.env.TINKER_SELECT_BG ?? '')
  ? `48;5;${process.env.TINKER_SELECT_BG}`
  : bg('#1E2733', 236);

export function useColor(env: Record<string, string | undefined> = process.env): boolean {
  return !env.NO_COLOR;
}

/** Bold, dim and reverse are attributes, not colours, and survive `NO_COLOR`. */
export function isAttribute(sgr: string): boolean {
  return sgr === BOLD || sgr === DIM || sgr === REVERSE;
}

export type Tone = 'running' | 'ready' | 'waiting' | 'attention' | 'failed' | 'done' | 'draft';

export const TONES: Record<Tone, { icon: string; sgr: string }> = {
  running: { icon: '●', sgr: SKY },
  ready: { icon: '○', sgr: SKY },
  waiting: { icon: '·', sgr: INK2 },
  attention: { icon: '◆', sgr: BRASS },
  failed: { icon: '✕', sgr: RED },
  done: { icon: '✓', sgr: GREEN },
  draft: { icon: '', sgr: DIM },
};
