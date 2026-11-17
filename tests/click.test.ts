import { describe, expect, test } from 'bun:test';
import { hyperlink, linkAt, paint } from '../tui/render/paint';
import { decode } from '../tui/runtime/keys';
import { clicksLinks } from '../tui/runtime/tty';

describe('clicking a link', () => {
  test('decode reads a left press, with modifiers, and ignores the release and other buttons', () => {
    expect(decode('\x1b[<0;12;3M')).toEqual([{ name: 'click', x: 12, y: 3 }]);
    expect(decode('\x1b[<16;5;2M')).toEqual([{ name: 'click', x: 5, y: 2 }]);
    expect(decode('\x1b[<0;12;3m')).toEqual([]);
    expect(decode('\x1b[<2;12;3M')).toEqual([]);
    expect(decode('\x1b[<64;1;1M')).toEqual([{ name: 'wheel-up' }]);
  });

  test('linkAt finds the hyperlink under a column, through colour codes', () => {
    const line = paint([['  ', null], ['SV-4244', '1', 'https://x/browse/SV-4244'], ['  To Do', null]], 40, false);
    expect(linkAt([line], 5, 1)).toBe('https://x/browse/SV-4244');
    expect(linkAt([line], 11, 1)).toBe('https://x/browse/SV-4244');
    expect(linkAt([line], 12, 1)).toBeNull();
    expect(linkAt([line], 3, 1)).toBeNull();
    expect(linkAt([line], 5, 2)).toBeNull();
    expect(linkAt(null, 1, 1)).toBeNull();
  });

  test('linkAt tells two links on one line apart', () => {
    const line = `ab${hyperlink('cd', 'u1')}e${hyperlink('fg', 'u2')}`;
    expect(linkAt([line], 3, 1)).toBe('u1');
    expect(linkAt([line], 5, 1)).toBeNull();
    expect(linkAt([line], 7, 1)).toBe('u2');
  });

  test('the TUI takes clicks in Apple Terminal, or when asked', () => {
    expect(clicksLinks({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(true);
    expect(clicksLinks({ TERM_PROGRAM: 'iTerm.app' })).toBe(false);
    expect(clicksLinks({ TERM_PROGRAM: 'iTerm.app', TINKER_CLICK: '1' })).toBe(true);
    expect(clicksLinks({ TERM_PROGRAM: 'Apple_Terminal', TINKER_CLICK: '0' })).toBe(false);
  });
});
