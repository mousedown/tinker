import { describe, expect, test } from 'bun:test';
import { mkdtempSync, appendFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { addUsage, claudeDir, count, parseAuthStatus, parseHudCache, tokensOf } from '../tui/account';
import { stripAnsi } from '../tui/render/text';
import { paint } from '../tui/render/paint';
import { identity, profileName, usageStrip } from '../tui/strip';

const assistant = (id: string, usage: Record<string, number>) => JSON.stringify({ type: 'assistant', message: { id, usage, content: [] } });

describe('account', () => {
  test('claudeDir follows CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    expect(claudeDir({ CLAUDE_CONFIG_DIR: '/x/.claude-work2' })).toBe('/x/.claude-work2');
    expect(claudeDir({ CLAUDE_CONFIG_DIR: '  ' })).toEndWith('/.claude');
    expect(claudeDir({})).toEndWith('/.claude');
  });

  test('parseAuthStatus reads the account and names the plan', () => {
    const out = JSON.stringify({ loggedIn: true, email: 'a@b.io', subscriptionType: 'max', planTier: 'max_20x', configDirectory: '/x/.claude-work2' });
    expect(parseAuthStatus(out, '/fallback')).toEqual({ email: 'a@b.io', plan: 'Max 20x', dir: '/x/.claude-work2' });
    expect(parseAuthStatus(JSON.stringify({ loggedIn: false }), '/d')).toBeNull();
    expect(parseAuthStatus('not json', '/d')).toBeNull();
  });

  test('parseHudCache takes the current reading, falling back to the last good one', () => {
    const good = { fiveHour: 2, sevenDay: 46, fiveHourResetAt: '2026-11-15T00:10:00Z', sevenDayResetAt: '2026-11-18T09:00:00Z' };
    const l = parseHudCache(JSON.stringify({ data: good, timestamp: 5 }))!;
    expect(l).toMatchObject({ fiveHour: 2, sevenDay: 46, at: 5 });
    expect(l.fiveHourResetAt).toBe(Date.parse('2026-11-15T00:10:00Z'));
    expect(parseHudCache(JSON.stringify({ data: { apiUnavailable: true }, lastGoodData: good, timestamp: 9 }))?.sevenDay).toBe(46);
    expect(parseHudCache(JSON.stringify({ data: {} }))).toBeNull();
    expect(parseHudCache('{')).toBeNull();
  });

  test('addUsage counts each message once and leaves cache reads out', () => {
    const lines = [
      assistant('m1', { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 20 }),
      assistant('m1', { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 20 }),
      JSON.stringify({ type: 'user', message: { usage: { input_tokens: 999 } } }),
      assistant('m2', { input_tokens: 1, output_tokens: 2 }),
    ].join('\n');
    expect(addUsage(lines, { input: 0, output: 0 }, new Set())).toEqual({ input: 111, output: 22 });
  });

  test('tokensOf reads only what was appended, and waits for a whole line', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tinker-')), 's.jsonl');
    writeFileSync(path, assistant('a', { input_tokens: 5, output_tokens: 5 }) + '\n');
    expect(tokensOf(path)).toEqual({ input: 5, output: 5 });
    const next = assistant('b', { input_tokens: 1, output_tokens: 1 });
    appendFileSync(path, next.slice(0, 20));
    expect(tokensOf(path)).toEqual({ input: 5, output: 5 });
    appendFileSync(path, next.slice(20) + '\n');
    expect(tokensOf(path)).toEqual({ input: 6, output: 6 });
    expect(tokensOf(null)).toEqual({ input: 0, output: 0 });
  });

  test('count shortens', () => {
    expect([count(950), count(1234), count(12_345), count(3_400_000)]).toEqual(['950', '1.2k', '12k', '3.4M']);
  });

  test('identity names the account, its plan and the profile', () => {
    const line = stripAnsi(paint(identity({ account: { email: 'a@b.io', plan: 'Max 20x', dir: '/p/.claude-work2' }, limits: null }), 200));
    expect(line).toBe('◉ a@b.io · Max 20x · claude-work2');
    expect(stripAnsi(paint(identity({ account: null, limits: null }), 200))).toContain('not logged in');
    expect(identity(null)).toEqual([]);
    expect(profileName('/Users/x/.claude')).toBe('claude');
  });

  test('usageStrip shows the limits and the spend', () => {
    const now = Date.parse('2026-11-14T21:00:00Z');
    const limits = { fiveHour: 2, sevenDay: 46, fiveHourResetAt: null, sevenDayResetAt: null, at: now };
    const line = stripAnsi(paint(usageStrip({ account: null, limits }, 3_400_000, now), 200));
    expect(line).toContain('5h 2%');
    expect(line).toContain('week 46%');
    expect(line).toContain('tinker 3.4M tokens');
    expect(line).not.toContain('ago)');
  });

  test('usageStrip flags limits nobody has refreshed, and is empty with nothing to show', () => {
    const now = Date.parse('2026-11-14T21:00:00Z');
    const limits = { fiveHour: 2, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null, at: now - 40 * 60_000 };
    const line = stripAnsi(paint(usageStrip({ account: null, limits }, 0, now), 200));
    expect(line).toContain('(read 40m ago)');
    expect(line).not.toContain('tinker');
    expect(usageStrip({ account: null, limits: null }, 0, now)).toEqual([]);
  });
});
