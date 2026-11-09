import { LOGO_ROWS, LOGO_WIDTH, MINI_WIDTH, TAGLINE, logo, miniLogo } from './brand';
import type { Row } from './data';
import { crumbs, keyLines, paint, type Hint } from './render/paint';
import { headerRow, layout, tableRow, type Column } from './render/table';
import { wrap, type Seg } from './render/text';
import { BOLD, BRASS, DIM, GREEN, INK, INK2, RED, SKY } from './render/theme';
import { isLive, needsYou, selected, visible, type State } from './state';

export function age(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

export function stateCell(r: Row): Seg[] {
  if (r.verdict?.kind === 'PARKED') return [['◆ parked', BRASS]];
  if (r.state === 'blocked') return [['◆ needs you', BRASS]];
  if (r.state === 'working') return [['● working', SKY]];
  if (r.state === 'failed') return [['✕ failed', RED]];
  if (r.state === 'stopped') return [['· stopped', INK2]];
  if (r.state === 'done' && r.verdict?.kind === 'DONE') return [['✓ done', GREEN]];
  if (r.state === 'done') return [['✓ ended', INK2]];
  return [[r.state, INK2]];
}

export function prCell(r: Row): Seg[] {
  if (!r.pr) return [['—', DIM]];
  const p = r.pr;
  const status =
    p.state === 'MERGED' ? (['merged', GREEN] as Seg) : p.state === 'CLOSED' ? (['closed', DIM] as Seg) : p.draft ? (['draft', INK2] as Seg) : (['ready', SKY] as Seg);
  return [[`#${p.number}`, INK, p.url], [' ', null], status];
}

export function ciCell(r: Row): Seg[] {
  const ci = r.pr?.ci ?? 'none';
  if (ci === 'pass') return [['✓', GREEN]];
  if (ci === 'fail') return [['✕', RED]];
  if (ci === 'pending') return [['…', BRASS]];
  return [['—', DIM]];
}

function whatCell(r: Row): Seg[] {
  if (r.verdict)
    return [
      [`${r.verdict.kind} `, r.verdict.kind === 'DONE' ? GREEN : BRASS],
      [r.verdict.text.replace(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/g, '#$1'), INK2],
    ];
  const last = r.said[r.said.length - 1]?.split('\n').find((l) => l.trim());
  return last ? [[last.trim(), INK2]] : [['', null]];
}

const COLUMNS: Column[] = [
  { key: 'state', title: 'STATE', width: 12 },
  { key: 'issue', title: 'ISSUE', width: 12 },
  { key: 'pr', title: 'PR', width: 13, drop: 3 },
  { key: 'ci', title: 'CI', width: 2, drop: 1 },
  { key: 'age', title: 'AGE', width: 4, align: 'right', drop: 2 },
  { key: 'what', title: 'LATEST', width: 20, flex: true },
];

function summary(state: State): Seg[] {
  const rows = state.rows;
  const need = rows.filter(needsYou).length;
  const working = rows.filter((r) => r.state === 'working').length;
  const done = visible(state).filter((r) => r.verdict?.kind === 'DONE').length;
  const parts: Seg[] = [];
  const add = (seg: Seg) => {
    if (parts.length) parts.push([' · ', DIM]);
    parts.push(seg);
  };
  if (need) add([`◆ ${need} need you`, BRASS]);
  if (working) add([`● ${working} working`, SKY]);
  if (done) add([`✓ ${done} done`, GREEN]);
  if (!parts.length) parts.push(['nothing running', DIM]);
  parts.push(['   ', null], [state.filter === 'active' ? 'active' : 'all sessions', DIM]);
  return parts;
}

function header(state: State, steps: string[]): Seg[][] {
  const w = state.width;
  const lines: Seg[][] = [];
  if (state.view === 'list' && state.height >= 24 && w >= LOGO_WIDTH) {
    lines.push(...logo(w), TAGLINE);
  } else if (w >= MINI_WIDTH + 20) {
    const mini = miniLogo();
    lines.push(mini[0], mini[1]);
  }
  lines.push([], [...crumbs(steps), ['   ', null], ...summary(state)]);
  return lines;
}

function footer(state: State, hints: [Hint[], Hint[]]): Seg[][] {
  if (state.input !== null)
    return [[['New issue › ', SKY], [state.input, BOLD], ['█', SKY]], [['ABC-123 · 42 · issue URL · "a description" · --note "…"   enter launch · esc cancel', DIM]]];
  const msg: Seg[] = state.message ? [[state.message.text, state.message.tone === 'error' ? RED : BRASS]] : [];
  return [msg, ...keyLines(hints[0], hints[1], state.width - 2)];
}

function fill(lines: string[], height: number): string[] {
  if (lines.length > height) return lines.slice(0, height);
  return [...lines, ...Array(height - lines.length).fill('')];
}

function listScreen(state: State): string[] {
  const w = state.width;
  const top = header(state, ['sessions']).map((l) => paint(l, w));
  const bottom = footer(state, [
    [['↑↓', 'select'], ['enter', 'open']],
    [['a', 'attach'], ['n', 'new'], ['o', 'PR'], ['x', 'stop'], ['f', state.filter === 'active' ? 'all' : 'active'], ['q', 'quit']],
  ]).map((l) => paint(l, w));

  const cols = layout(COLUMNS, w - 2);
  const rows = visible(state);
  const body: string[] = [paint([['  ', null], ...headerRow(cols)], w)];
  const room = Math.max(1, state.height - top.length - bottom.length - 2);

  if (!state.loaded) body.push(paint([['  Loading sessions…', DIM]], w));
  else if (rows.length === 0)
    body.push(
      paint([['  No Tinker sessions. ', DIM], ['n', BOLD], [' launches one, or run ', DIM], ['tinker ABC-123', BOLD], ['.', DIM]], w)
    );
  else {
    const sel = selected(state);
    const at = Math.max(0, rows.findIndex((r) => r.id === sel?.id));
    const start = Math.min(Math.max(0, at - Math.floor(room / 2)), Math.max(0, rows.length - room));
    for (const r of rows.slice(start, start + room)) {
      const cells: Record<string, Seg[]> = {
        state: stateCell(r),
        issue: [[r.key ?? r.label, isLive(r) ? BOLD : INK]],
        pr: prCell(r),
        ci: ciCell(r),
        age: [[age(state.now - r.startedAt), DIM]],
        what: whatCell(r),
      };
      body.push(paint(tableRow(cols, cells), w, r.id === sel?.id));
    }
  }
  return [...top, ...fill(body, state.height - top.length - bottom.length), ...bottom];
}

function detailScreen(state: State, r: Row): string[] {
  const w = state.width;
  const top = header(state, ['sessions', r.key ?? r.label]).map((l) => paint(l, w));
  const bottom = footer(state, [
    [['esc', 'back'], ['↑↓', 'prev/next']],
    [['enter', 'attach'], ['o', 'PR'], ['x', 'stop'], ['q', 'quit']],
  ]).map((l) => paint(l, w));

  const field = (label: string, value: Seg[]): string => paint([[`  ${label.padEnd(9)}`, DIM], ...value], w);
  const body: string[] = [
    field('state', stateCell(r)),
    field('session', [[`${r.id}`, INK], ['  ', null], [`claude attach ${r.id}`, DIM]]),
    field('started', [[`${age(state.now - r.startedAt)} ago`, INK]]),
    field('repo', [[r.cwd.replace(process.env.HOME ?? '~', '~'), INK2]]),
    field('PR', r.pr ? [...prCell(r), ['  CI ', DIM], ...ciCell(r), ['  ', null], [r.pr.title, INK2]] : [['none yet', DIM]]),
    field('verdict', r.verdict ? whatCell(r) : [['none yet', DIM]]),
    '',
    paint([['  Latest from the worker', BOLD]], w),
  ];
  const room = state.height - top.length - bottom.length - body.length;
  const said: string[] = [];
  for (const text of r.said.slice(-3)) {
    for (const line of text.split('\n')) for (const part of wrap(line, w - 6)) said.push(paint([['    ', null], [part, INK2]], w));
    said.push('');
  }
  body.push(...said.slice(-Math.max(0, room)));
  return [...top, ...fill(body, state.height - top.length - bottom.length), ...bottom];
}

export function screen(state: State): string[] {
  const row = selected(state);
  const lines = state.view === 'detail' && row ? detailScreen(state, row) : listScreen(state);
  return fill(lines, state.height);
}

export function plainTable(state: State, color: boolean): string {
  const cols = layout(COLUMNS, 120);
  const out = [paint(headerRow(cols), 120, undefined, color)];
  for (const r of visible(state)) {
    out.push(
      paint(
        tableRow(cols, {
          state: stateCell(r),
          issue: [[r.key ?? r.label, null]],
          pr: prCell(r),
          ci: ciCell(r),
          age: [[age(state.now - r.startedAt), null]],
          what: whatCell(r),
        }),
        120,
        undefined,
        color
      )
    );
  }
  if (out.length === 1) out.push('No Tinker sessions.');
  return out.join('\n') + '\n';
}
