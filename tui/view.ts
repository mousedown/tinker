import type { Row } from './data';
import { markdown } from './markdown';
import { keyLines, paint, type Hint } from './render/paint';
import { headerRow, layout, tableRow, type Column } from './render/table';
import type { Seg } from './render/text';
import { AMBER, BLUE, BOLD, BRASS, DIM, GREEN, INK, INK2, MAGENTA, RED, SKY } from './render/theme';
import { MENU, fit, isLive, landed, needsYou, newest, pendingOf, phaseOf, selected, selectedIssue, shownIssues, targets, ticketOf, tidyOf, visible, type State, type Tracker } from './state';
import { sessionFor, type Issue } from './issues';
import { identity, machineStrip, usageStrip } from './strip';
import { segsWidth, truncate } from './render/text';
import { count, total } from './account';
import { VERSION } from './version';

export function age(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

const SPIN = ['◐', '◓', '◑', '◒'];

export function stateCell(r: Row, state: State): Seg[] {
  const now = state.now;
  const pending = pendingOf(state, r);
  if (pending && !(pending.waitFor === 'session' && r.state === 'working'))
    return [[`${SPIN[Math.floor(now / 500) % SPIN.length]} ${pending.verb}…`, SKY]];
  const phase = phaseOf(r);
  if (r.state === 'working') return [[`${SPIN[Math.floor(now / 500) % SPIN.length]} ${phase === 'fixing-ci' ? 'fixing CI' : 'working'}`, SKY]];
  if (landed(r)) return [['⌫ merged', MAGENTA]];
  if (phase === 'awaiting-approval') return [['◆ awaiting approval', BRASS]];
  if (phase === 'ci-failing') return [['✕ CI failing', RED]];
  if (phase === 'green') return [['✓ green', GREEN]];
  if (r.verdict?.kind === 'PARKED' && !isLive(r)) return [['◆ parked', BRASS]];
  if (r.state === 'blocked') return [['◆ needs you', BRASS]];
  const tidy = tidyOf(r, now);
  if (tidy) return [[`⌫ ${tidy}`, MAGENTA]];
  if (r.state === 'failed') return [['✕ failed', RED]];
  if (r.state === 'stopped') return [['· stopped', INK2]];
  if (r.state === 'done' && r.verdict?.kind === 'DONE') return [['✓ done', GREEN]];
  if (r.state === 'done') return [['✓ ended', INK2]];
  return [[r.state, INK2]];
}

export function prCell(r: Row): Seg[] {
  if (!r.pr) return [['—', DIM]];
  const p = r.pr;
  const status: Seg =
    p.state === 'MERGED'
      ? ['merged', GREEN]
      : p.state === 'CLOSED'
        ? ['closed', DIM]
        : p.draft
          ? ['draft', INK2]
          : p.autoMerge
            ? ['auto', GREEN]
            : ['ready', SKY];
  return [[`#${p.number}`, INK, p.url], [' ', null], status];
}

const BAR = 6;

export function ciBar(pass: number, fail: number, pending: number, width = BAR): [number, number, number] {
  const total = pass + fail + pending;
  if (total === 0) return [0, 0, 0];
  const share = (n: number) => (n === 0 ? 0 : Math.max(1, Math.round((n / total) * width)));
  let f = share(fail);
  let p = share(pending);
  if (f + p > width) p = Math.max(0, width - f);
  if (f > width) f = width;
  return [f, p, width - f - p];
}

export function ciCell(r: Row): Seg[] {
  const p = r.pr;
  if (!p || p.ci === 'none') return [['—', DIM]];
  const { pass, fail, pending } = p.checks;
  const [f, w, ok] = ciBar(pass, fail, pending);
  const url = p.checksUrl;
  const figure: Seg = fail ? [` ✕${fail}`, RED, url] : pending ? [` …${pending}`, BRASS, url] : [` ✓${pass}`, GREEN, url];
  const bar: Seg[] = [];
  if (f) bar.push(['■'.repeat(f), RED, url]);
  if (w) bar.push(['■'.repeat(w), BRASS, url]);
  if (ok) bar.push(['■'.repeat(ok), GREEN, url]);
  return [...bar, figure];
}

function whatCell(r: Row, state?: State): Seg[] {
  const pending = state ? pendingOf(state, r) : null;
  if (pending) {
    const secs = Math.max(0, Math.round((state!.now - pending.since) / 1000));
    return [[`${pending.verb}, ${secs}s · ${pending.waitFor === 'session' ? 'waiting for the session to start' : 'running'}`, SKY]];
  }
  if (r.state === 'working' && r.activity && state) {
    const secs = Math.max(0, Math.round((state.now - r.activity.at) / 1000));
    const ago = secs < 90 ? `${secs}s` : `${Math.round(secs / 60)}m`;
    return [[r.activity.text, INK], [`  ${ago}`, secs > 300 ? BRASS : DIM]];
  }
  if (r.verdict && !isLive(r))
    return [
      [`${r.verdict.kind} `, r.verdict.kind === 'DONE' ? GREEN : BRASS],
      [r.verdict.text.replace(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/g, '#$1'), INK2],
    ];
  if (r.status?.text && r.state !== 'working') return [[r.status.text, INK2]];
  const last = r.said[r.said.length - 1]?.split('\n').find((l) => l.trim());
  return last ? [[last.trim().replace(/[*`#>]/g, ''), INK2]] : [['', null]];
}

const COLUMNS: Column[] = [
  { key: 'mark', title: '', width: 1 },
  { key: 'state', title: 'STATE', width: 19 },
  { key: 'issue', title: 'ISSUE', width: 12 },
  { key: 'title', title: 'TITLE', width: 28, drop: 0 },
  { key: 'pr', title: 'PR', width: 13, drop: 3 },
  { key: 'ci', title: 'CI', width: 10, drop: 1 },
  { key: 'age', title: 'AGE', width: 4, align: 'right', drop: 2 },
  { key: 'what', title: 'LATEST', width: 20, flex: true },
];

function summary(state: State): Seg[] {
  const rows = [...newest(state.rows).values()];
  const need = rows.filter(needsYou).length;
  const red = rows.filter((r) => phaseOf(r) === 'ci-failing').length;
  const working = rows.filter((r) => r.state === 'working').length;
  const tidy = rows.filter((r) => tidyOf(r, state.now)).length;
  const done = visible(state).filter((r) => r.verdict?.kind === 'DONE' && !tidyOf(r, state.now)).length;
  const parts: Seg[] = [];
  const add = (seg: Seg) => {
    if (parts.length) parts.push([' · ', DIM]);
    parts.push(seg);
  };
  if (need) add([`◆ ${need} need you`, BRASS]);
  if (red) add([`✕ ${red} CI failing`, RED]);
  if (working) add([`● ${working} working`, SKY]);
  if (done) add([`✓ ${done} done`, GREEN]);
  if (tidy) add([`⌫ ${tidy} to tidy`, MAGENTA]);
  const busy = visible(state).filter((r) => pendingOf(state, r)).length;
  if (busy) add([`⟳ ${busy} in progress`, SKY]);
  if (state.marks.length) add([`☑ ${state.marks.length} ticked`, BOLD]);
  if (!parts.length) parts.push(['nothing running', DIM]);
  parts.push(['   ', null], [state.filter === 'active' ? 'active' : 'all sessions', DIM]);
  return parts;
}

function chip(key: string, label: string, on: boolean): Seg[] {
  return [[key, BOLD], [` ${label} `, DIM], [on ? '●' : '○', on ? GREEN : DIM]];
}

export function toggles(state: State): Seg[] {
  const s = state.settings;
  return [
    ...chip('D', 'draft', s.draft),
    ['  ', null],
    ...chip('M', 'merge', s.autoMerge),
    ['  ', null],
    ...chip('T', 'tidy', s.autoTidy),
  ];
}

export function versionTag(state: State): Seg[] {
  return state.update
    ? [[`↑ ${state.update}: tinker update`, AMBER], ['  ', null], [`v${VERSION}`, DIM]]
    : [[`v${VERSION}`, DIM]];
}

const PAGES = [
  ['1', 'Sessions', 'sessions'],
  ['2', 'Issues', 'issues'],
] as const;

/** `🐙 tinker ── 1 Sessions │ 2 Issues`, the open page bright, then where you are inside it. */
export function tabs(state: State, inside: string[] = []): Seg[] {
  const segs: Seg[] = [['🐙 ', null], ['tinker', BLUE], [' ── ', DIM]];
  PAGES.forEach(([n, label, page], i) => {
    const open = state.page === page;
    if (i > 0) segs.push([' │ ', DIM]);
    segs.push([n, open ? SKY : DIM], [` ${label}`, open ? BOLD : DIM]);
  });
  for (const step of inside) segs.push([' › ', DIM], [step, BOLD]);
  return segs;
}

/** `│ left ··· right │`, exactly `width` cells; the right side goes first when there's no room. */
function boxRow(left: Seg[], right: Seg[], width: number): Seg[] {
  const inner = width - 4;
  const fits = right.length > 0 && segsWidth(left) + 3 + segsWidth(right) <= inner;
  const body = truncate(left, inner);
  const used = segsWidth(body) + (fits ? segsWidth(right) : 0);
  return [['│ ', DIM], ...body, [' '.repeat(Math.max(0, inner - used)), null], ...(fits ? right : []), [' │', DIM]];
}

/** The border: `╭─ title ──── tag ─╮`, the tag dropped before the title is cut. */
function boxEdge(title: Seg[], tag: Seg[], width: number): Seg[] {
  const room = width - 6;
  const withTag = segsWidth(title) + 2 + segsWidth(tag) <= room;
  const t = truncate(title, room);
  const fill = room - segsWidth(t) - (withTag ? segsWidth(tag) + 2 : 0);
  return [['╭─ ', DIM], ...t, [` ${'─'.repeat(Math.max(0, fill))}`, DIM], ...(withTag ? ([[' ', null], ...tag] as Seg[]) : []), [' ─╮', DIM]];
}

/**
 * The header panel: the tabs and version in its border, then the status with the toggles (the
 * trackers on Issues), who you are with the plan's usage, and the machine.
 */
function header(state: State, steps: string[], sums: Seg[] = summary(state), right: Seg[] = toggles(state)): Seg[][] {
  const w = state.width;
  const bySession = new Map(state.rows.map((r) => [r.sessionId, r.tokens ? total(r.tokens) : 0] as const));
  const usage = usageStrip(state.account, [...bySession.values()].reduce((n, t) => n + t, 0), state.now);
  const machine: Seg[] = state.machine ? machineStrip(state.machine) : [['measuring the machine…', DIM]];
  return [
    boxEdge(tabs(state, steps), versionTag(state), w),
    boxRow(sums, right, w),
    boxRow(identity(state.account), usage, w),
    boxRow(machine, [], w),
    [['╰', DIM], ['─'.repeat(Math.max(0, w - 2)), DIM], ['╯', DIM]],
    [],
  ];
}

const FIELD_LABEL = { site: 'Jira site', email: 'Email', token: 'API token' } as const;

function footer(state: State, hints: [Hint[], Hint[]]): Seg[][] {
  if (state.input?.kind === 'jira') {
    const f = state.input.field;
    const value = f === 'token' ? '•'.repeat(state.input.token.length) : state.input[f];
    const help =
      f === 'site'
        ? 'your Jira address, e.g. acme.atlassian.net · enter next · esc cancel'
        : f === 'email'
          ? 'the email you sign in to Jira with · enter next · esc cancel'
          : 'paste the token from the page that just opened · enter connect · esc cancel';
    return [[[`${FIELD_LABEL[f]} › `, SKY], [value, BOLD], ['█', SKY]], [[help, DIM]]];
  }
  if (state.input?.kind === 'new')
    return [[['New issue › ', SKY], [state.input.text, BOLD], ['█', SKY]], [['ABC-123 · 42 · issue URL · "a description" · --note "…"   enter launch · esc cancel', DIM]]];
  if (state.menu !== null) {
    const names = targets(state).map((r) => r.key ?? r.label);
    const what = state.marks.length ? `${names.length} ticked: ${names.join(', ')}` : names[0] ?? '';
    return [
      [['Act on ', DIM], [what, BOLD]],
      ...MENU.map((item, i): Seg[] => {
        const on = i === state.menu;
        const f = fit(state, item.spec);
        const none = f.ok === 0;
        const count = f.of > 1 ? `${f.ok}/${f.of}`.padEnd(6) : '';
        const note = none ? `— ${f.why}` : f.ok < f.of ? `${item.hint} (skips: ${f.why})` : item.hint;
        return [
          [on ? '› ' : '  ', on ? SKY : null],
          [item.key, none ? DIM : BOLD],
          ['  ', null],
          [item.label.padEnd(18), none ? DIM : on ? SKY : INK],
          [count, DIM],
          [note, DIM],
        ];
      }),
      [['↑↓ choose · enter or the letter runs it · esc closes', DIM]],
    ];
  }
  if (state.confirm) return [[[state.confirm.text, BRASS]], []];
  const msg: Seg[] = state.message ? [[state.message.text, state.message.tone === 'error' ? RED : BRASS]] : [];
  return [msg, ...keyLines(hints[0], hints[1], state.width - 2)];
}

function fill(lines: string[], height: number): string[] {
  if (lines.length > height) return lines.slice(0, height);
  return [...lines, ...Array(height - lines.length).fill('')];
}

function cells(state: State, r: Row, color: boolean): Record<string, Seg[]> {
  return {
    mark: state.marks.includes(r.id) ? [['☑', BOLD]] : [[' ', null]],
    state: stateCell(r, state),
    issue: [[r.key ?? r.label, color && isLive(r) ? BOLD : color ? INK : null, ticketOf(r, state.issues).url ?? undefined]],
    title: [[ticketOf(r, state.issues).title ?? '', INK2]],
    pr: prCell(r),
    ci: ciCell(r),
    age: [[age(state.now - r.startedAt), DIM]],
    what: whatCell(r, state),
  };
}

function listScreen(state: State): string[] {
  const w = state.width;
  const top = header(state, []).map((l) => paint(l, w));
  const bottom = footer(state, [
    [['2', 'issues'], ['↑↓', 'select'], ['space', 'tick'], ['*', 'tick group'], ['t', 'tick tidy'], ['enter', 'open']],
    [['m', 'menu'], ['p', 'prepare'], ['c', 'clean up'], ['a', 'attach'], ['o', 'PR'], ['i', 'CI'], ['n', 'new'], ['x', 'stop'], ['f', state.filter === 'active' ? 'all' : 'active'], ['q', 'quit']],
  ]).map((l) => paint(l, w));

  const rows = visible(state);
  const titled = rows.some((r) => ticketOf(r, state.issues).title);
  const cols = layout(COLUMNS.filter((c) => c.key !== 'title' || titled), w - 2);
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
    for (const r of rows.slice(start, start + room)) body.push(paint(tableRow(cols, cells(state, r, true)), w, r.id === sel?.id));
  }
  return [...top, ...fill(body, state.height - top.length - bottom.length), ...bottom];
}

function detailScreen(state: State, r: Row): string[] {
  const w = state.width;
  const top = header(state, [r.key ?? r.label]).map((l) => paint(l, w));
  const bottom = footer(state, [
    [['esc', 'back'], ['↑↓', 'prev/next']],
    [['enter', 'attach'], ['m', 'menu'], ['p', 'prepare'], ['o', 'PR'], ['i', 'CI'], ['x', 'stop'], ['q', 'quit']],
  ]).map((l) => paint(l, w));

  const field = (label: string, value: Seg[]): string => paint([[`  ${label.padEnd(9)}`, DIM], ...value], w);
  const ci = r.pr?.checks;
  const body: string[] = [
    field('state', stateCell(r, state)),
    field('issue', (() => {
      const t = ticketOf(r, state.issues);
      return [[r.key ?? r.label, INK, t.url ?? undefined], ...(t.title ? ([['  ', null], [t.title, INK2]] as Seg[]) : [])] as Seg[];
    })()),
    field('session', [[`${r.id}`, INK], ['  ', null], [`claude attach ${r.id}`, DIM]]),
    field('started', [[`${age(state.now - r.startedAt)} ago`, INK]]),
    field(
      'tokens',
      r.tokens && total(r.tokens)
        ? [[count(total(r.tokens)), INK], [`  ${count(r.tokens.input)} in · ${count(r.tokens.output)} out · cache reads not counted`, DIM]]
        : [['none yet', DIM]]
    ),
    field('repo', [[r.cwd.replace(process.env.HOME ?? '~', '~'), INK2]]),
    field('PR', r.pr ? [...prCell(r), ['  ', null], [r.pr.title, INK2]] : [['none yet', DIM]]),
    field(
      'CI',
      r.pr && ci && r.pr.ci !== 'none'
        ? [...ciCell(r), ['   ', null], [`${ci.pass} passed · ${ci.fail} failed · ${ci.pending} running`, INK2, r.pr.checksUrl]]
        : [['none yet', DIM]]
    ),
    ...(r.state === 'working' && r.activity ? [field('now', whatCell(r, state))] : []),
    ...(r.status ? [field('status', [[r.status.kind, INK], ['  ', null], [r.status.text, INK2]])] : []),
    field('verdict', r.verdict && !isLive(r) ? whatCell(r) : [['none yet', DIM]]),
    '',
    paint([['  Latest from the worker', BOLD]], w),
  ];
  const room = state.height - top.length - bottom.length - body.length;
  const said: string[] = [];
  for (const text of r.said.slice(-3)) {
    for (const line of markdown(text, w - 6)) said.push(paint([['    ', null], ...line], w));
    said.push('');
  }
  body.push(...said.slice(-Math.max(0, room)));
  return [...top, ...fill(body, state.height - top.length - bottom.length), ...bottom];
}

export function screen(state: State): string[] {
  const row = selected(state);
  const lines = state.page === 'issues' ? issuesScreen(state) : state.view === 'detail' && row ? detailScreen(state, row) : listScreen(state);
  return fill(lines, state.height);
}

export function plainTable(state: State, color: boolean): string {
  const cols = layout(COLUMNS.filter((c) => c.key !== 'mark' && c.key !== 'title'), 120);
  const out = [paint(headerRow(cols), 120, undefined, color)];
  for (const r of visible(state)) out.push(paint(tableRow(cols, cells(state, r, color)), 120, undefined, color));
  if (out.length === 1) out.push('No Tinker sessions.');
  return out.join('\n') + '\n';
}

function trackerChip(name: string, t: Tracker, key: string): Seg[] {
  const label: Seg[] = [[`${name} `, INK2]];
  switch (t.state) {
    case 'connected':
      return [...label, [`● ${name === 'Jira' ? 'connected as ' : ''}${t.who ?? ''}`, GREEN]];
    case 'rejected':
      return [...label, [`▲ token rejected — ${key} to reconnect`, RED]];
    case 'unreachable':
      return [...label, ['▲ unreachable', AMBER]];
    case 'loading':
      return [...label, ['◐ loading', SKY]];
    default:
      return [...label, [`○ not connected — ${key} to connect`, DIM]];
  }
}

const ISSUE_COLUMNS: Column[] = [
  { key: 'mark', title: '', width: 1 },
  { key: 'src', title: 'SRC', width: 3 },
  { key: 'key', title: 'KEY', width: 10 },
  { key: 'status', title: 'STATUS', width: 13, drop: 0 },
  { key: 'title', title: 'TITLE', width: 20, flex: true },
  { key: 'session', title: 'SESSION', width: 19, drop: 3 },
  { key: 'pr', title: 'PR', width: 13, drop: 2 },
  { key: 'ci', title: 'CI', width: 10, drop: 1 },
];

function issueCells(state: State, i: Issue): Record<string, Seg[]> {
  const r = sessionFor(i, state.rows);
  return {
    mark: state.issues.marks.includes(i.url) ? [['☑', BOLD]] : [['☐', DIM]],
    src: [[i.source === 'jira' ? 'J' : 'GH', DIM]],
    key: [[i.key, r && isLive(r) ? INK2 : BOLD, i.url]],
    status: [[i.status, INK2]],
    title: [[i.title, INK]],
    session: r ? stateCell(r, state) : [['—', DIM]],
    pr: r ? prCell(r) : [['—', DIM]],
    ci: r ? ciCell(r) : [['—', DIM]],
  };
}

export function issuesScreen(state: State): string[] {
  const w = state.width;
  const is = state.issues;
  const shown = shownIssues(state);
  const sums: Seg[] = [[`${shown.length} issue${shown.length === 1 ? '' : 's'}`, INK2]];
  if (is.marks.length) sums.push([' · ', DIM], [`☑ ${is.marks.length} ticked`, BOLD]);
  if (is.filter || is.filtering) sums.push(['   / ', DIM], [is.filter, BOLD], ...(is.filtering ? ([['█', SKY]] as Seg[]) : []));
  const trackers: Seg[] = [...trackerChip('Jira', is.jira, 'J'), ['   ', null], ...trackerChip('GitHub', is.github, 'G')];
  const top = header(state, [], sums, trackers).map((l) => paint(l, w));
  const act: Hint[] = [['enter', 'launch'], ['/', 'filter'], ['o', 'open'], ['r', 'refresh'], ['J', 'connect Jira']];
  if (is.github.state !== 'connected') act.push(['G', 'connect GitHub']);
  act.push(['q', 'quit']);
  const bottom = footer(state, [[['1', 'sessions'], ['↑↓', 'select'], ['space', 'tick'], ['*', 'all']], act]).map((l) => paint(l, w));

  const cols = layout(ISSUE_COLUMNS, w - 2);
  const body: string[] = [paint([['  ', null], ...headerRow(cols)], w)];
  const room = Math.max(1, state.height - top.length - bottom.length - 1);
  const connected = is.jira.state === 'connected' || is.github.state === 'connected';
  if (is.loadedAt === null) body.push(paint([['  Loading issues…', DIM]], w));
  else if (shown.length === 0) {
    const why = is.filter
      ? `No issues match "${is.filter}".`
      : connected
        ? 'Nothing assigned to you is open.'
        : 'Connect a tracker: J for Jira, G for GitHub.';
    body.push(paint([[`  ${why}`, DIM]], w));
  } else {
    const sel = selectedIssue(state);
    const at = Math.max(0, shown.findIndex((i) => i.url === sel?.url));
    const start = Math.min(Math.max(0, at - Math.floor(room / 2)), Math.max(0, shown.length - room));
    for (const i of shown.slice(start, start + room)) body.push(paint(tableRow(cols, issueCells(state, i)), w, i.url === sel?.url));
  }
  return [...top, ...fill(body, state.height - top.length - bottom.length), ...bottom];
}
