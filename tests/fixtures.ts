import type { Pr, Row } from '../tui/data';

export function pr(over: Partial<Pr>): Pr {
  return {
    number: 1,
    title: 't',
    branch: 'b',
    url: 'u',
    state: 'OPEN',
    draft: true,
    ci: 'none',
    checks: { pass: 0, fail: 0, pending: 0 },
    checksUrl: 'u/checks',
    autoMerge: false,
    base: 'main',
    ...over,
  };
}

const now = 1_800_000_000_000;
export const NOW = now;

export function row(over: Partial<Row>): Row {
  return {
    id: 'a1b2c3d4',
    sessionId: 'a1b2c3d4-0000-0000-0000-000000000000',
    cwd: '/repo',
    state: 'working',
    startedAt: now - 30 * 60000,
    name: '🐙 ABC-1',
    key: 'ABC-1',
    label: 'ABC-1',
    pr: null,
    verdict: null,
    said: [],
    ...over,
  };
}

export const ROWS: Row[] = [
  row({ id: 'w1', key: 'ABC-101', label: 'ABC-101', said: ['Reproduced the bug with a failing spec; fixing the date parser now.'] }),
  row({ id: 'b1', key: 'ABC-102', label: 'ABC-102', state: 'blocked', startedAt: now - 3 * 3600000 }),
  row({
    id: 'd1', key: 'ABC-103', label: 'ABC-103', state: 'done', startedAt: now - 5 * 3600000,
    verdict: { kind: 'DONE', text: 'https://github.com/o/r/pull/2571 P0=0 P1=0 P2=2' },
    pr: pr({ number: 2571, title: 'fix(booking): ABC-103 keep the slot', branch: 'fix/ABC-103', url: 'https://github.com/o/r/pull/2571', ci: 'pass', checks: { pass: 12, fail: 0, pending: 0 }, checksUrl: 'https://github.com/o/r/pull/2571/checks' }),
  }),
  row({
    id: 'p1', key: 'ABC-104', label: 'ABC-104', state: 'done', startedAt: now - 2 * 3600000,
    verdict: { kind: 'PARKED', text: 'missing-decision should refunds be pro-rata?' },
  }),
  row({ id: 'f1', key: 'ABC-105', label: 'ABC-105', state: 'failed', startedAt: now - 7 * 3600000,
    pr: pr({ number: 2580, title: 'ABC-105', branch: 'fix/ABC-105', ci: 'fail', checks: { pass: 9, fail: 2, pending: 1 }, checksUrl: 'https://ci/run/7' }) }),
  row({ id: 'o1', key: 'ABC-90', label: 'ABC-90', state: 'done', startedAt: now - 3 * 86400000 }),
];
