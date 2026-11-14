import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pkg from '../package.json';

const BIN = join(import.meta.dir, '..', 'bin', 'tinker');
// A PATH without `claude` makes an accidental launch fail instead of starting a real session.
const run = (...args: string[]) =>
  Bun.spawnSync(['bash', BIN, ...args], { env: { ...process.env, PATH: `/usr/bin:/bin`, TINKER_REPO: import.meta.dir } });

interface Fake {
  id: string;
  pid?: number;
  state?: string;
}

/**
 * A stub `claude` listing the given live sessions, a fake `ps`, and a cache of its own, so the
 * launcher's memory figures come from the test and the real ~/.cache is never touched.
 */
function machine(live: Fake[] | number = [], opts: { ps?: string; peaks?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tinker-cli-'));
  const fakes: Fake[] = typeof live === 'number' ? Array.from({ length: live }, (_, i) => ({ id: `z${i}` })) : live;
  const list = JSON.stringify(fakes.map((f, i) => ({ kind: 'background', name: `🐙 ZZZ-${i}`, state: f.state ?? 'working', id: f.id, pid: f.pid ?? null })));
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\n[ "$1" = agents ] && echo '${list}'\nexit 0\n`);
  chmodSync(join(dir, 'claude'), 0o755);
  writeFileSync(join(dir, 'ps'), opts.ps ?? '');
  mkdirSync(join(dir, 'cache', 'tinker'), { recursive: true });
  if (opts.peaks) writeFileSync(join(dir, 'cache', 'tinker', 'peaks'), opts.peaks);
  const launch = (env: Record<string, string>, ...args: string[]) => {
    const r = Bun.spawnSync(['bash', BIN, '--dry-run', ...args], {
      env: {
        ...process.env,
        TINKER_NO_UPDATE_CHECK: '1',
        TINKER_SESSION_MB: '',
        TINKER_MAX_SESSIONS: '',
        PATH: `${dir}:/usr/bin:/bin:${process.env.PATH}`,
        TINKER_REPO: import.meta.dir,
        TINKER_PS: join(dir, 'ps'),
        XDG_CACHE_HOME: join(dir, 'cache'),
        ...env,
      },
    });
    return r.stdout.toString().trim().split('\n');
  };
  return {
    launch: (env: Record<string, string>, ...args: string[]) => launch(env, ...args).map((l) => l.split('\t').slice(0, 2).join(' ')),
    full: launch,
    peaks: () => (existsSync(join(dir, 'cache', 'tinker', 'peaks')) ? readFileSync(join(dir, 'cache', 'tinker', 'peaks'), 'utf8') : ''),
  };
}

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

  for (const [arg, why] of [
    ['logs', "no 'logs' command"],
    ['993b5c65', 'looks like a session id'],
    ['fixit', 'quoted description of several words'],
    ['https://github.com/o/r/pull/3', 'no issue in that link'],
  ]) {
    test(`${arg} is refused and nothing launches`, () => {
      const r = run('ABC-1', arg);
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toContain(`Not an issue: ${arg}`);
      expect(r.stderr.toString()).toContain(why);
      expect(r.stdout.toString()).toBe('');
    });
  }

  test('update is a command, not an issue', () => {
    expect(run('--help').stdout.toString()).toContain('tinker update');
  });
});

describe('room to launch', () => {
  // 16 GB, 8 GB of it free. With no readings yet a session is budgeted 2 GB, and a 10% reserve
  // leaves room for three.
  const MEM = { TINKER_MEM_MB: '16384 8192' };
  const now = () => Math.floor(Date.now() / 1000);
  // ps -A -o pid=,ppid=,rss= (KB): session 100 runs a build (101) under it, 200 sits idle.
  const PS = ['1 0 1000', '100 1 400000', '101 100 2700000', '200 1 300000', '999 1 9000000'].join('\n');

  test('with no readings, the default budget decides; the rest are held', () => {
    const { launch } = machine();
    expect(launch(MEM, 'ABC-1', 'ABC-2', 'ABC-3', 'ABC-4')).toEqual(['ABC-1 dry-run', 'ABC-2 dry-run', 'ABC-3 dry-run', 'ABC-4 held']);
  });

  test('a session costs what the hungriest one used, children included, and its peak is kept', () => {
    // a's tree is 3 GB (session + build); b's 300 MB. Unrelated pid 999 is not counted.
    const m = machine([{ id: 'a', pid: 100 }, { id: 'b', pid: 200, state: 'blocked' }], { ps: PS });
    const [line] = m.full(MEM, 'ABC-1', 'ABC-2');
    // (8192 − 1638) / 3027 → 2.
    expect(m.launch(MEM, 'ABC-1', 'ABC-2', 'ABC-3')).toEqual(['ABC-1 dry-run', 'ABC-2 dry-run', 'ABC-3 held']);
    expect(line).toContain('ABC-1\tdry-run');
    const peaks = Object.fromEntries(m.peaks().trim().split('\n').map((l) => [l.split(' ')[0], Number(l.split(' ')[2])]));
    expect(peaks).toEqual({ a: 3027, b: 293 });
  });

  test('a working session below its peak keeps room to grow back to it', () => {
    // a peaked at 4 GB earlier and uses 3 GB now: 1 GB is kept for it. (8192 − 1638 − 1068) / 4096 → 1.
    const m = machine([{ id: 'a', pid: 100 }], { ps: PS, peaks: `a ${now() - 60} 4096\n` });
    expect(m.launch(MEM, 'ABC-1', 'ABC-2')).toEqual(['ABC-1 dry-run', 'ABC-2 held']);
    expect(m.full(MEM, 'ABC-1', 'ABC-2')[1]).toContain('~4096 MB per session, 1068 MB kept for running ones to grow');
    expect(m.peaks()).toContain('a ');
    expect(m.peaks()).toContain(' 4096');
  });

  test('small readings are floored at 1 GB, and week-old ones forgotten', () => {
    const m = machine([], { peaks: `x ${now()} 300\nold ${now() - 8 * 86400} 8000\n` });
    // (8192 − 1638) / 1024 → 6.
    expect(m.launch(MEM, 'A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7').filter((l) => l.endsWith('held'))).toEqual(['A-7 held']);
    expect(m.peaks()).not.toContain('old');
  });

  test('TINKER_SESSION_MB fixes the budget', () => {
    expect(machine().launch({ ...MEM, TINKER_SESSION_MB: '4096' }, 'ABC-1', 'ABC-2')).toEqual(['ABC-1 dry-run', 'ABC-2 held']);
  });

  test('TINKER_MAX_SESSIONS counts the sessions already running', () => {
    expect(machine(2).launch({ ...MEM, TINKER_MAX_SESSIONS: '3' }, 'ABC-1', 'ABC-2')).toEqual(['ABC-1 dry-run', 'ABC-2 held']);
  });

  test('--force and TINKER_SESSION_MB=0 launch everything', () => {
    const { launch } = machine();
    const low = { TINKER_MEM_MB: '16384 1000' };
    expect(launch(low, 'ABC-1')).toEqual(['ABC-1 held']);
    expect(launch(low, '--force', 'ABC-1')).toEqual(['ABC-1 dry-run']);
    expect(launch({ ...low, TINKER_SESSION_MB: '0' }, 'ABC-1')).toEqual(['ABC-1 dry-run']);
  });

  test('issues normalise: keys upper-cased, tracker links become their key, descriptions pass', () => {
    const { launch } = machine();
    expect(
      launch(
        { TINKER_SESSION_MB: '0' },
        'abc-7',
        'https://acme.atlassian.net/browse/SV-3855',
        'https://acme.atlassian.net/jira/software/projects/SV/boards/1?selectedIssue=SV-12',
        '#42',
        'https://github.com/o/my-app-2/issues/9',
        'the footer overlaps the nav'
      )
    ).toEqual(['ABC-7 dry-run', 'SV-3855 dry-run', 'SV-12 dry-run', 'GH-42 dry-run', 'GH-9 dry-run', 'the footer overlaps the nav dry-run']);
  });

  test('each worker gets a time budget, unless TINKER_MAX_MINUTES=0', () => {
    const { full } = machine();
    expect(full({}, 'ABC-1')[0]).toMatch(/Time budget: 120 minutes, so finish by \d{4}-\d\d-\d\dT\d\d:\d\dZ \(UTC\)/);
    expect(full({ TINKER_MAX_MINUTES: '30' }, 'ABC-1')[0]).toContain('Time budget: 30 minutes');
    expect(full({ TINKER_MAX_MINUTES: '0' }, 'ABC-1')[0]).not.toContain('Time budget');
  });

  test('a held issue says why', () => {
    const [line] = machine().full({ TINKER_MEM_MB: '16384 1000' }, 'ABC-1');
    expect(line).toBe('ABC-1\theld\tno room left (1000 MB free, ~2048 MB per session); run it again later or pass --force');
  });
});
