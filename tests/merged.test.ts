import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../tui/render/text';
import { COMMANDS, initialState, needsYou, reduce, tidyOf, type State } from '../tui/state';
import { screen } from '../tui/view';
import { NOW, pr, row } from './fixtures';

const landed = row({ id: 'b1', key: 'SV-2829', label: 'SV-2829', name: '🐙 SV-2829', state: 'blocked', pr: pr({ number: 3148, state: 'MERGED', branch: 'fix/SV-2829' }) });
const stillWorking = row({ id: 'w1', key: 'SV-1', label: 'SV-1', name: '🐙 SV-1', state: 'working', pr: pr({ number: 9, state: 'MERGED', branch: 'fix/SV-1' }) });
const asking = row({ id: 'q1', key: 'SV-2', label: 'SV-2', name: '🐙 SV-2', state: 'blocked', pr: pr({ number: 10, state: 'OPEN' }) });
const loaded = (rows = [landed, stillWorking, asking]): State => reduce(initialState(160, 30), { type: 'rows', rows, now: NOW }).state;

describe('a merged PR ends the work', () => {
  test('a session stopped at a prompt after its PR merged does not need you, and is tidyable', () => {
    expect(needsYou(landed)).toBe(false);
    expect(tidyOf(landed, NOW)).toBe('merged');
    expect(needsYou(asking)).toBe(true);
    expect(tidyOf(asking, NOW)).toBeNull();
  });

  test('a session still working is left alone even when its PR merged', () => {
    expect(tidyOf(stillWorking, NOW)).toBeNull();
  });

  test('the list says merged, and only the real question counts as needing you', () => {
    const t = screen(loaded()).map(stripAnsi).join('\n');
    expect(t).toMatch(/⌫ merged\s+SV-2829/);
    expect(t).toContain('◆ 1 need you');
  });

  test('cleaning up stops the waiting session first', () => {
    const plan = COMMANDS.cleanup.plan(landed, loaded());
    expect(plan).toEqual({
      ok: true,
      effect: { type: 'cleanup', id: 'b1', ids: ['b1'], stop: ['b1'], cwd: '/repo', label: 'SV-2829', branch: 'fix/SV-2829' },
    });
  });

  test('auto-tidy takes it too', () => {
    const s = reduce({ ...loaded(), settings: { ...initialState(1, 1).settings, autoTidy: true } }, { type: 'rows', rows: [landed], now: NOW });
    expect(s.effects).toEqual([{ type: 'cleanup', id: 'b1', ids: ['b1'], stop: ['b1'], cwd: '/repo', label: 'SV-2829', branch: 'fix/SV-2829' }]);
  });
});
