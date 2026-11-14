import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import pkg from '../package.json';

export const VERSION: string = pkg.version;

/** True when `a` is a newer x.y.z than `b`. Pre-release and build suffixes are ignored. */
export function newer(a: string, b: string): boolean {
  const parts = (v: string) => v.replace(/[-+].*/, '').split('.').map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** The latest release the launcher last saw (it checks at most once a day), if newer than this one. */
export function availableUpdate(env: Record<string, string | undefined> = process.env): string | null {
  try {
    const dir = join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'tinker');
    const latest = readFileSync(join(dir, 'latest'), 'utf8').trim();
    return latest && newer(latest, VERSION) ? latest : null;
  } catch {
    return null;
  }
}
