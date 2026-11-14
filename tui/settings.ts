import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export interface Settings {
  draft: boolean;
  autoMerge: boolean;
  autoTidy: boolean;
  /** Overrides the Issues page's Jira query. */
  jql: string | null;
}

export const DEFAULTS: Settings = { draft: false, autoMerge: false, autoTidy: false, jql: null };

export function settingsPath(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return env.TINKER_SETTINGS || join(base, 'tinker', 'settings.json');
}

export function loadSettings(path = settingsPath()): Settings {
  try {
    if (!existsSync(path)) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>;
    return {
      draft: raw.draft === true,
      autoMerge: raw.autoMerge === true,
      autoTidy: raw.autoTidy === true,
      jql: typeof raw.jql === 'string' && raw.jql.trim() ? raw.jql : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings, path = settingsPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
}
