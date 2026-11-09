import { cellWidth, type Seg } from './render/text';
import { BOLD, DIM, INK2, SKY } from './render/theme';

const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)>\]]+)/g;

export function inline(text: string, base: string | null = INK2): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push([text.slice(at, m.index), base]);
    if (m[1] ?? m[2]) out.push([m[1] ?? m[2], BOLD]);
    else if (m[3]) out.push([m[3], SKY]);
    else if (m[4]) out.push([m[4], SKY, m[5]]);
    else if (m[6]) out.push([m[6], SKY, m[6]]);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push([text.slice(at), base]);
  return out;
}

function words(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const [text, sgr, link] of segs)
    for (const part of text.split(/(\s+)/))
      if (part) out.push(link ? [part, sgr, link] : [part, sgr]);
  return out;
}

function breakWord(seg: Seg, width: number): Seg[] {
  const [text, sgr, link] = seg;
  const pieces: Seg[] = [];
  let head = '';
  for (const ch of text) {
    if (cellWidth(head + ch) > width) {
      pieces.push(link ? [head, sgr, link] : [head, sgr]);
      head = '';
    }
    head += ch;
  }
  if (head) pieces.push(link ? [head, sgr, link] : [head, sgr]);
  return pieces;
}

export function wrapSegs(segs: Seg[], width: number, first: Seg[] = [], rest: Seg[] = first): Seg[][] {
  const lines: Seg[][] = [];
  const indent = (n: number) => (n === 0 ? first : rest);
  let line: Seg[] = [...indent(0)];
  let used = cellWidth(line.map((s) => s[0]).join(''));
  let content = false;
  const room = () => Math.max(1, width - cellWidth(indent(lines.length).map((s) => s[0]).join('')));
  const flush = () => {
    lines.push(line);
    line = [...indent(lines.length)];
    used = cellWidth(line.map((s) => s[0]).join(''));
    content = false;
  };
  for (const word of words(segs)) {
    const blank = !word[0].trim();
    if (blank) {
      if (content && used + 1 <= width) {
        line.push([' ', null]);
        used += 1;
      }
      continue;
    }
    const pieces = cellWidth(word[0]) > room() ? breakWord(word, room()) : [word];
    for (const piece of pieces) {
      const w = cellWidth(piece[0]);
      if (content && used + w > width) {
        while (line.length && !line[line.length - 1][0].trim()) line.pop();
        flush();
      }
      line.push(piece);
      used += w;
      content = true;
    }
  }
  lines.push(line);
  return lines;
}

export function markdown(text: string, width: number): Seg[][] {
  const out: Seg[][] = [];
  let fenced = false;
  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push([['  ', null], [raw, SKY]]);
      continue;
    }
    if (!raw.trim()) {
      out.push([]);
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(raw);
    if (heading) {
      out.push(...wrapSegs(inline(heading[1], BOLD), width));
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(raw)) {
      out.push([['─'.repeat(Math.min(width, 24)), DIM]]);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(raw)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) continue;
      const cells = raw.trim().slice(1, -1).split('|').map((c) => c.trim());
      const segs: Seg[] = cells.flatMap((c, i): Seg[] => [...(i ? ([[' │ ', DIM]] as Seg[]) : []), ...inline(c)]);
      out.push(segs);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(raw);
    if (quote) {
      out.push(...wrapSegs(inline(quote[1], DIM), width, [['│ ', DIM]]));
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (item) {
      const depth = Math.min(3, Math.floor(item[1].length / 2));
      const pad = '  '.repeat(depth);
      const bullet = /\d/.test(item[2]) ? `${item[2]} ` : '• ';
      const box = /^\[( |x|X)\]\s+(.*)$/.exec(item[3]);
      const marker = box ? (box[1] === ' ' ? '☐ ' : '☑ ') : bullet;
      const body = box ? box[2] : item[3];
      out.push(...wrapSegs(inline(body), width, [[pad + marker, DIM]], [[pad + ' '.repeat(cellWidth(marker)), null]]));
      continue;
    }
    out.push(...wrapSegs(inline(raw.trim()), width));
  }
  return out;
}
