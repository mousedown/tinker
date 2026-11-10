import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import pkg from '../package.json';

const BIN = join(import.meta.dir, '..', 'bin', 'tinker');
// A PATH without `claude` makes an accidental launch fail instead of starting a real session.
const run = (...args: string[]) =>
  Bun.spawnSync(['bash', BIN, ...args], { env: { ...process.env, PATH: `/usr/bin:/bin`, TINKER_REPO: import.meta.dir } });

describe('tinker CLI', () => {
  for (const flag of ['--version', '-v']) {
    test(`${flag} prints the version and launches nothing`, () => {
      const r = run(flag);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString().trim()).toBe(`tinker ${pkg.version}`);
    });
  }

  test('an unknown flag is refused, not launched as an issue', () => {
    const r = run('--nope');
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain('Unknown option: --nope');
    expect(r.stdout.toString()).not.toContain('launched');
  });
});
