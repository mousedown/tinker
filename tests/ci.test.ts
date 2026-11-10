import { describe, expect, test } from 'bun:test';
import { countChecks, statusOf } from '../tui/data';
import { stripAnsi } from '../tui/render/text';
import { COMMANDS, fixCiPrompt, initialState, needsYou, phaseOf, reduce, visible, type State } from '../tui/state';
import { screen, stateCell } from '../tui/view';
import { NOW, pr, row } from './fixtures';

const red = (over = {}) => pr({ number: 7, ci: 'fail', checks: { pass: 8, fail: 1, pending: 0, gate: 0 }, ...over });
const gated = (over = {}) => pr({ number: 8, ci: 'fail', checks: { pass: 8, fail: 1, pending: 0, gate: 1 }, ...over });
const green = (over = {}) => pr({ number: 9, ci: 'pass', checks: { pass: 9, fail: 0, pending: 0, gate: 0 }, ...over });
const loaded = (rows: ReturnType<typeof row>[]): State => reduce(initialState(140, 40), { type: 'rows', rows, now: NOW }).state;

describe('tinker-status line', () => {
  test('reads the status at the top of the final message, with or without a separator or backticks', () => {
    expect(statusOf(['Watching CI.', 'tinker-status: awaiting-approval Review gate needs a CODEOWNERS approval\n\nTINKER DONE x'])).toEqual({
      kind: 'awaiting-approval',
      text: 'Review gate needs a CODEOWNERS approval',
    });
    expect(statusOf(['`tinker-status: green — all 12 required checks passed`'])).toEqual({ kind: 'green', text: 'all 12 required checks passed' });
    expect(statusOf(['Tinker-Status: CI-FAILING: integration still red after 3 attempts'])?.kind).toBe('ci-failing');
  });

  test('a later TINKER line without a status hides an older one, and prose that mentions it does not count', () => {
    expect(statusOf(['tinker-status: green ok\nTINKER DONE a', 'Prepared.\nTINKER DONE b'])).toBeNull();
    expect(statusOf(['tinker-status: blocked why', 'still going'])?.kind).toBe('blocked');
    expect(statusOf(['the contract wants tinker-status: green at the top'])).toBeNull();
    expect(statusOf(['tinker-status: purple nope'])).toBeNull();
  });
});

describe('approval gates', () => {
  test('a failing check named as an approval or review gate, or asking for action, is human-only', () => {
    const checks = [
      { name: 'Review gate', conclusion: 'FAILURE' },
      { context: 'Protected files approval', state: 'FAILURE' },
      { name: 'deploy', conclusion: 'ACTION_REQUIRED' },
      { name: 'integration', conclusion: 'FAILURE' },
      { name: 'Review gate', conclusion: 'SUCCESS' },
    ];
    expect(countChecks(checks)).toEqual({ pass: 1, fail: 4, pending: 0, gate: 3 });
  });
});

describe('phase', () => {
  test('falls back to the checks when the worker left no status line', () => {
    expect(phaseOf(row({ state: 'blocked', pr: red() }))).toBe('ci-failing');
    expect(phaseOf(row({ state: 'blocked', pr: gated() }))).toBe('awaiting-approval');
    expect(phaseOf(row({ state: 'done', pr: green() }))).toBe('green');
    expect(phaseOf(row({ state: 'blocked', pr: pr({ ci: 'pending' }) }))).toBeNull();
    expect(phaseOf(row({ state: 'done', pr: red({ state: 'MERGED' }) }))).toBeNull();
    expect(phaseOf(row({ state: 'failed', pr: red() }))).toBeNull();
  });

  test('a running session on a red PR is fixing CI', () => {
    expect(phaseOf(row({ state: 'working', pr: red() }))).toBe('fixing-ci');
    expect(phaseOf(row({ state: 'working', pr: green() }))).toBeNull();
  });

  test('prefers the status line, unless the checks have since moved on', () => {
    const said = (kind: 'green' | 'awaiting-approval' | 'ci-failing' | 'blocked') => ({ kind, text: 'why' });
    expect(phaseOf(row({ state: 'blocked', pr: red(), status: said('awaiting-approval') }))).toBe('awaiting-approval');
    expect(phaseOf(row({ state: 'blocked', pr: pr({ ci: 'pending' }), status: said('ci-failing') }))).toBe('ci-failing');
    expect(phaseOf(row({ state: 'blocked', pr: green(), status: said('awaiting-approval') }))).toBe('green');
    expect(phaseOf(row({ state: 'blocked', pr: red(), status: said('green') }))).toBe('ci-failing');
    expect(phaseOf(row({ state: 'blocked', pr: green(), status: said('blocked') }))).toBe('blocked');
    expect(phaseOf(row({ state: 'blocked', status: said('blocked') }))).toBe('blocked');
  });

  test('only an approval or a parked question needs you; red CI is its own state and sorts next', () => {
    const rows = [
      row({ id: 'g', key: 'ABC-1', label: 'ABC-1', state: 'blocked', pr: green() }),
      row({ id: 'r', key: 'ABC-2', label: 'ABC-2', state: 'blocked', pr: red() }),
      row({ id: 'a', key: 'ABC-3', label: 'ABC-3', state: 'blocked', pr: gated() }),
      row({ id: 'w', key: 'ABC-4', label: 'ABC-4', state: 'working', pr: red() }),
    ];
    expect(rows.map(needsYou)).toEqual([false, false, true, false]);
    const s = loaded(rows);
    expect(visible(s).map((r) => r.id)).toEqual(['a', 'r', 'w', 'g']);
    expect(rows.map((r) => stripAnsi(stateCell(r, s).map((x) => x[0]).join('')))).toEqual([
      '✓ green',
      '✕ CI failing',
      '◆ awaiting approval',
      expect.stringMatching(/^[◐◓◑◒] fixing CI$/),
    ]);
    const text = stripAnsi(screen(s).join('\n'));
    expect(text).toContain('◆ 1 need you');
    expect(text).toContain('✕ 1 CI failing');
  });

  test('the status reason is the latest line for an idle session', () => {
    const r = row({ id: 'a', state: 'blocked', pr: gated(), status: { kind: 'awaiting-approval', text: 'Review gate: protected files need an owner' } });
    expect(stripAnsi(screen(loaded([r])).join('\n'))).toContain('Review gate: protected files need an owner');
  });

  test('fix CI leaves a PR that only waits on an approval, and asks for the CI loop', () => {
    const s = loaded([row({ state: 'blocked', pr: gated() })]);
    expect(COMMANDS['fix-ci'].plan(s.rows[0], s)).toEqual({ ok: false, why: 'awaiting approval' });
    const prompt = fixCiPrompt(row({ pr: red() }));
    expect(prompt).toContain('re-run a flaky or stale gate once');
    expect(prompt).toContain('tinker-status');
  });
});
