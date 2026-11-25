import { describe, expect, test } from 'bun:test';
import { PR_MS, prWait } from '../tui/data';

describe('prWait', () => {
  test('a healthy PR query is repeated once a minute', () => {
    expect(PR_MS).toBe(60_000);
    expect(prWait(0)).toBe(60_000);
  });

  test('each failed query doubles the wait before the next one', () => {
    expect(prWait(1)).toBe(120_000);
    expect(prWait(2)).toBe(240_000);
    expect(prWait(3)).toBe(480_000);
  });

  test('the wait is capped at ten minutes however many queries fail', () => {
    expect(prWait(4)).toBe(600_000);
    expect(prWait(40)).toBe(600_000);
  });

  test('a negative count is treated as no failures', () => {
    expect(prWait(-1)).toBe(60_000);
  });
});
