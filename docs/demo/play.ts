#!/usr/bin/env bun
// The README's animated TUI, played from a script. Every frame is drawn by Tinker's own reducer
// and renderer (tui/state.ts, tui/view.ts); only the sessions, PRs and machine figures are
// invented, and the keys are pressed by the timeline below rather than by a person.
//
//   bun docs/demo/play.ts            # watch it in your terminal
//   vhs docs/demo/tui.tape           # record assets/tui.gif

import type { Pr, Row } from '../../tui/data';
import type { MachineView } from '../../tui/machine';
import type { Key } from '../../tui/runtime/keys';
import { initialState, reduce, type State } from '../../tui/state';
import { screen } from '../../tui/view';

const T0 = Date.now();
const NOW = () => Date.now();

const ISSUES = ['ABC-101', 'ABC-102', 'ABC-103', 'ABC-104', '#42'];
const START: Record<string, number> = {};

function pr(n: number, key: string, over: Partial<Pr> = {}): Pr {
  const url = `https://github.com/acme/shop/pull/${n}`;
  return {
    number: n,
    title: key,
    branch: `fix/${key.replace('#', 'GH-')}`,
    url,
    state: 'OPEN',
    draft: true,
    ci: 'pending',
    checks: { pass: 0, fail: 0, pending: 12 },
    checksUrl: `${url}/checks`,
    autoMerge: false,
    base: 'main',
    ...over,
  };
}

const checks = (pass: number, fail: number, pending: number) => ({ pass, fail, pending });

// What each session looks like at a moment, keyed by issue. Later entries replace earlier ones.
const rows = new Map<string, Row>();

function put(key: string, over: Partial<Row>): void {
  const had = rows.get(key);
  const id = over.id ?? had?.id ?? `${key.replace(/\W/g, '').toLowerCase()}a1b2c3`.slice(0, 8);
  rows.set(key, {
    id,
    sessionId: `${id}-0000-4000-8000-000000000000`,
    cwd: '/Users/you/code/shop',
    state: 'working',
    startedAt: START[key] ?? NOW(),
    name: `🐙 ${key}`,
    key,
    label: key,
    pr: null,
    verdict: null,
    said: [],
    activity: null,
    status: null,
    ...had,
    ...over,
  });
}

const doing = (key: string, text: string) => put(key, { activity: { text, at: NOW() } });

function machine(sessions: number): MachineView {
  const used = 14_200 + sessions * 2_700;
  return {
    cpu: 0.18 + sessions * 0.09,
    load1: 2.1 + sessions * 1.4,
    cores: 12,
    mem: { totalMb: 65_536, usedMb: used, availableMb: 65_536 - used },
    swapUsedMb: null,
    disk: { freeMb: 412_000, totalMb: 994_000 },
    capacity: { room: Math.max(0, 15 - sessions * 2), perSessionMb: 2_900, heldBackMb: 0, learned: true },
  };
}

const char = (ch: string): Key => ({ name: 'char', ch }) as Key;
const named = (name: string): Key => ({ name }) as Key;

type Beat = [at: number, run: () => void];
const beats: Beat[] = [];
let clock = 0;
const at = (secs: number, run: () => void) => beats.push([(clock = secs) * 1000, run]);
const then = (secs: number, run: () => void) => at(clock + secs, run);

let state: State = initialState(process.stdout.columns || 130, process.stdout.rows || 40);
const press = (k: Key) => (state = reduce(state, { type: 'key', key: k }).state);
const sync = () => (state = reduce(state, { type: 'rows', rows: [...rows.values()], now: NOW() }).state);
const live = () => [...rows.values()].filter((r) => r.state === 'working').length;

// 1. Nothing running. Launch five issues from the TUI.
at(0.2, () => {
  state = reduce(state, { type: 'machine', machine: machine(0), now: NOW() }).state;
  sync();
});
at(1.4, () => press(char('n')));
const line = ISSUES.join(' ');
for (const ch of line) then(0.045, () => press(char(ch)));
then(0.7, () => press(named('enter')));

// 2. The sessions start, one by one, and get to work.
ISSUES.forEach((key, i) =>
  at(3.4 + i * 0.35, () => {
    START[key] = NOW();
    put(key, {});
    doing(key, 'Reading the issue and the code it names');
  })
);
at(5.4, () => doing('ABC-101', 'Wrote a failing spec: two bookings can share a slot'));
then(0.5, () => doing('ABC-103', 'Triage: the export 500s when the cart is empty'));
then(0.6, () => doing('#42', 'Made a worktree at fix/GH-42; reproducing locally'));
then(0.5, () => doing('ABC-104', 'Reading the refunds policy in docs/billing.md'));
then(0.5, () => doing('ABC-102', 'Wrote a failing test for the timezone shift'));

// 3. PRs open and CI runs.
at(8.2, () => put('ABC-103', { pr: pr(2571, 'ABC-103'), activity: { text: 'Draft PR open; self-review round 1', at: NOW() } }));
then(0.6, () => doing('ABC-101', 'Smallest fix: lock the slot row before the insert'));
then(0.6, () => put('ABC-103', { pr: pr(2571, 'ABC-103', { checks: checks(5, 0, 7) }) }));
then(0.6, () =>
  put('ABC-104', {
    state: 'done',
    activity: null,
    verdict: { kind: 'PARKED', text: 'missing-decision should a part refund be pro-rata? recommend yes' },
    said: [
      '**Parked: missing-decision**\n\nThe ticket says \"refund the unused part\" of a subscription, but not how to count it.\n\n- **Pro-rata by day** matches what Stripe does on a downgrade. **Recommended.**\n- **Whole months only** is simpler, and is what the old admin tool did.\n\nThe tests for both are written; answer with `claude attach` and I will finish whichever you pick.',
    ],
  })
);
then(0.6, () => put('#42', { pr: pr(2574, '#42', { checks: checks(3, 0, 9) }), activity: { text: 'Draft PR open; watching CI', at: NOW() } }));
then(0.6, () => put('ABC-103', { pr: pr(2571, 'ABC-103', { checks: checks(10, 0, 2) }) }));
then(0.6, () => put('#42', { pr: pr(2574, '#42', { ci: 'fail', checks: checks(9, 1, 2) }), activity: { text: 'lint: unused import in cart/export.ts — fixing', at: NOW() } }));
then(0.6, () =>
  put('ABC-103', {
    state: 'done',
    activity: null,
    pr: pr(2571, 'ABC-103', { ci: 'pass', checks: checks(12, 0, 0) }),
    status: { kind: 'green', text: 'all 12 checks pass' },
    verdict: { kind: 'DONE', text: 'https://github.com/acme/shop/pull/2571 P0=0 P1=0 P2=1' },
  })
);
then(0.7, () => put('ABC-101', { pr: pr(2572, 'ABC-101', { checks: checks(4, 0, 8) }), activity: { text: 'Draft PR open; self-review round 2', at: NOW() } }));
then(0.7, () => put('#42', { pr: pr(2574, '#42', { ci: 'pending', checks: checks(8, 0, 4) }), activity: { text: 'Pushed the fix; CI running again', at: NOW() } }));
then(0.7, () => put('ABC-101', { pr: pr(2572, 'ABC-101', { checks: checks(11, 0, 1) }) }));
then(0.7, () =>
  put('ABC-101', {
    state: 'done',
    activity: null,
    pr: pr(2572, 'ABC-101', { ci: 'pass', checks: checks(12, 0, 0) }),
    status: { kind: 'green', text: 'all 12 checks pass' },
    verdict: { kind: 'DONE', text: 'https://github.com/acme/shop/pull/2572 P0=0 P1=0 P2=0' },
  })
);
then(0.7, () =>
  put('#42', {
    state: 'done',
    activity: null,
    pr: pr(2574, '#42', { ci: 'pass', checks: checks(12, 0, 0) }),
    status: { kind: 'green', text: 'all 12 checks pass' },
    verdict: { kind: 'DONE', text: 'https://github.com/acme/shop/pull/2574 P0=0 P1=0 P2=1' },
  })
);

// 4. Read the parked one's question.
then(1.4, () => press(named('home')));
then(0.8, () => press(named('enter')));
then(4.2, () => press(named('esc')));

// 5. Tick the green group and prepare them all.
then(0.9, () => press(named('down')));
then(0.35, () => press(named('down')));
then(0.7, () => press(char('*')));
then(1.1, () => press(char('p')));
then(2.2, () =>
  ['ABC-101', 'ABC-103', '#42'].forEach((k) => {
    START[k] = NOW();
    put(k, { id: `${rows.get(k)!.id.slice(0, 6)}p2`, state: 'working', verdict: null, status: null, activity: { text: 'Merged main in; running the checks', at: NOW() } });
  })
);
then(1.6, () => doing('ABC-103', 'Review at the final head: clean'));
then(0.5, () => doing('#42', 'Rewrote the PR description'));
then(0.6, () =>
  put('ABC-103', {
    state: 'done',
    activity: null,
    pr: pr(2571, 'ABC-103', { draft: false, ci: 'pass', checks: checks(12, 0, 0) }),
    status: { kind: 'green', text: 'ready for review' },
    verdict: { kind: 'DONE', text: 'https://github.com/acme/shop/pull/2571 P0=0 P1=0 P2=0' },
  })
);
then(0.7, () =>
  put('#42', {
    state: 'done',
    activity: null,
    pr: pr(2574, '#42', { draft: false, ci: 'pass', checks: checks(12, 0, 0) }),
    status: { kind: 'green', text: 'ready for review' },
    verdict: { kind: 'DONE', text: 'https://github.com/acme/shop/pull/2574 P0=0 P1=0 P2=0' },
  })
);
then(0.7, () =>
  put('ABC-101', {
    state: 'done',
    activity: null,
    pr: pr(2572, 'ABC-101', { draft: false, ci: 'pass', checks: checks(12, 0, 0) }),
    status: { kind: 'green', text: 'ready for review' },
    verdict: { kind: 'DONE', text: 'https://github.com/acme/shop/pull/2572 P0=0 P1=0 P2=0' },
  })
);
then(1.2, () => put('ABC-103', { pr: pr(2571, 'ABC-103', { state: 'MERGED', draft: false, ci: 'pass', checks: checks(12, 0, 0) }) }));

// Draw. Alternate screen, no cursor, a frame every 80 ms; the last frame holds until Ctrl+C.
const out = process.stdout;
out.write('\x1b[?1049h\x1b[?25l');
const quit = () => {
  out.write('\x1b[?25h\x1b[?1049l');
  process.exit(0);
};
process.on('SIGINT', quit);

let next = 0;
const tick = () => {
  const t = Date.now() - T0;
  while (next < beats.length && beats[next][0] <= t) {
    beats[next++][1]();
    state = reduce(state, { type: 'machine', machine: machine(live()), now: NOW() }).state;
    sync();
  }
  state = { ...state, now: NOW() };
  out.write('\x1b[H' + screen(state).map((l) => l + '\x1b[K').join('\r\n'));
};
setInterval(tick, 80);
