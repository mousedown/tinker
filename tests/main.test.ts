import { describe, expect, test } from 'bun:test';
import { spawnInteractive } from '../tui/main';

describe('spawnInteractive', () => {
  test('a missing command is reported, not thrown', async () => {
    expect(await spawnInteractive(['tinker-no-such-command-xyz', '--help'])).toEqual({ ok: false, missing: true });
  });

  test('a command that runs reports its exit', async () => {
    expect(await spawnInteractive(['true'])).toEqual({ ok: true, missing: false });
    expect(await spawnInteractive(['false'])).toEqual({ ok: false, missing: false });
  });
});
