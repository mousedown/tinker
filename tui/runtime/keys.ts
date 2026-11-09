/** Decodes raw terminal input into keys, several sequences per chunk. */

export type KeyName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'shift-up'
  | 'shift-down'
  | 'pageup'
  | 'pagedown'
  | 'home'
  | 'end'
  | 'enter'
  | 'esc'
  | 'tab'
  | 'shift-tab'
  | 'backspace'
  | 'ctrl-c'
  | 'wheel-up'
  | 'wheel-down'
  | 'char';

export interface Key {
  name: KeyName;
  /** The character, for `char`. */
  ch?: string;
}

const CSI: Record<string, KeyName> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  Z: 'shift-tab',
  '1;2A': 'shift-up',
  '1;2B': 'shift-down',
  '1~': 'home',
  '7~': 'home',
  '4~': 'end',
  '8~': 'end',
  '5~': 'pageup',
  '6~': 'pagedown',
};

const SS3: Record<string, KeyName> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
};

export function decode(raw: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < raw.length) {
    const rest = raw.slice(i);

    // eslint-disable-next-line no-control-regex
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest);
    if (mouse) {
      const button = Number(mouse[1]);
      if (mouse[4] === 'M' && button === 64) keys.push({ name: 'wheel-up' });
      if (mouse[4] === 'M' && button === 65) keys.push({ name: 'wheel-down' });
      i += mouse[0].length;
      continue;
    }

    // eslint-disable-next-line no-control-regex
    const csi = /^\x1b\[([0-9;]*[A-Za-z~])/.exec(rest);
    if (csi) {
      const name = CSI[csi[1]];
      if (name) keys.push({ name });
      i += csi[0].length;
      continue;
    }

    // eslint-disable-next-line no-control-regex
    const ss3 = /^\x1bO([A-Z])/.exec(rest);
    if (ss3) {
      const name = SS3[ss3[1]];
      if (name) keys.push({ name });
      i += ss3[0].length;
      continue;
    }

    const ch = String.fromCodePoint(raw.codePointAt(i) ?? 0);
    i += ch.length;
    if (ch === '\x1b') keys.push({ name: 'esc' });
    else if (ch === '\r' || ch === '\n') keys.push({ name: 'enter' });
    else if (ch === '\t') keys.push({ name: 'tab' });
    else if (ch === '\x7f' || ch === '\b') keys.push({ name: 'backspace' });
    else if (ch === '\x03') keys.push({ name: 'ctrl-c' });
    else if (ch >= ' ') keys.push({ name: 'char', ch });
  }
  return keys;
}
