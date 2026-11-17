/** The terminal's modes, and putting them back however the TUI exits. */

import { spawn } from 'child_process';

const ESC = '\x1b[';
// No mouse reporting: it would send every click to the TUI, and cmd-click on a
// hyperlink would never reach the terminal. Alternate scroll mode (1007) turns
// the wheel into ↑ and ↓ on the alternate screen instead.
export const ENTER = `${ESC}?1049h${ESC}?25l${ESC}?1007h`;
export const LEAVE = `${ESC}?1007l${ESC}?25h${ESC}?1049l`;
// Click reporting, for a terminal with no OSC 8: the TUI opens the link under the click itself.
const MOUSE_ON = `${ESC}?1000h${ESC}?1006h`;
const MOUSE_OFF = `${ESC}?1006l${ESC}?1000l`;

/**
 * Whether the TUI should take clicks and open links itself: in a terminal that can't follow an OSC 8
 * hyperlink (Apple Terminal), or when `TINKER_CLICK=1`. `TINKER_CLICK=0` turns it off; with it on,
 * hold option to select text.
 */
export function clicksLinks(env: Record<string, string | undefined> = process.env): boolean {
  if (env.TINKER_CLICK === '1') return true;
  if (env.TINKER_CLICK === '0' || env.TINKER_LINKS === '0') return false;
  return env.TERM_PROGRAM === 'Apple_Terminal';
}

export interface TtyIn extends NodeJS.ReadableStream {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
}

export interface TtyOut extends NodeJS.WritableStream {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
}

export interface Terminal {
  enter(): void;
  leave(): void;
}

/** Alt screen, hidden cursor, SGR mouse and raw input; `leave` undoes each once. */
export function terminal(input: TtyIn, output: TtyOut, mouse = false): Terminal {
  let entered = false;
  return {
    enter() {
      if (entered) return;
      entered = true;
      output.write(mouse ? ENTER + MOUSE_ON : ENTER);
      if (input.isTTY) input.setRawMode?.(true);
      input.resume();
    },
    leave() {
      if (!entered) return;
      entered = false;
      if (input.isTTY) input.setRawMode?.(false);
      input.pause();
      output.write(mouse ? MOUSE_OFF + LEAVE : LEAVE);
    },
  };
}

/**
 * Restores the terminal on exit, on SIGTERM and SIGHUP, and on a crash, so a
 * failure never leaves the shell in raw mode on the alt screen.
 */
export function restoreOnExit(restore: () => void, onSignal: () => void): () => void {
  const crash = (error: unknown) => {
    restore();
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exit(1);
  };
  process.on('exit', restore);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSignal);
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  return () => {
    process.off('exit', restore);
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSignal);
    process.off('uncaughtException', crash);
    process.off('unhandledRejection', crash);
  };
}

/** Opens a URL in the default browser, without waiting for it. */
export function openUrl(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // No browser to open; the URL is on screen.
  }
}
