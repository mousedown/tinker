#!/usr/bin/env bun
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  issueKey,
  labelOf,
  prFor,
  pulls,
  repoRoot,
  sessions,
  transcript,
  withoutClaudeCode,
  type Pr,
  type Row,
} from './data';
import { machineSampler } from './machine';
import { decode } from './runtime/keys';
import { openUrl, restoreOnExit, terminal } from './runtime/tty';
import { diffFrame } from './runtime/writer';
import { stripAnsi } from './render/text';
import { useColor } from './render/theme';
import { loadSettings, saveSettings } from './settings';
import { COMMANDS, initialState, reduce, tidyOf, type Effect, type Msg, type State } from './state';
import { availableUpdate } from './version';
import { plainTable, screen } from './view';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = join(ROOT, 'bin', 'tinker');
const POLL_MS = 2000;
const PR_MS = 20000;

const prCache = new Map<string, { at: number; prs: Pr[] }>();

async function prsFor(root: string, force: boolean): Promise<Pr[]> {
  const hit = prCache.get(root);
  if (hit && !force && Date.now() - hit.at < PR_MS) return hit.prs;
  const prs = await pulls(root);
  if (prs === null) return hit?.prs ?? [];
  prCache.set(root, { at: Date.now(), prs });
  return prs;
}

export async function loadRows(force = false): Promise<Row[]> {
  const list = await sessions(true);
  const rootOf = new Map(await Promise.all([...new Set(list.map((s) => s.cwd))].map(async (c) => [c, await repoRoot(c)] as const)));
  const roots = [...new Set(rootOf.values())];
  const byRoot = new Map(await Promise.all(roots.map(async (r) => [r, await prsFor(r, force)] as const)));
  const prs = new Map([...rootOf].map(([cwd, root]) => [cwd, byRoot.get(root) ?? []] as const));
  return list.map((s) => {
    const { verdict, said, activity, status } = transcript(s);
    const key = issueKey(s.name);
    return { ...s, key, label: labelOf(s.name), verdict, said, activity, status, pr: prFor(key, prs.get(s.cwd) ?? [], verdict) };
  });
}

function splitArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

async function capture(cmd: string[], cwd?: string): Promise<{ ok: boolean; out: string }> {
  if (cwd && !existsSync(cwd)) return { ok: false, out: `${cwd} no longer exists` };
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', env: withoutClaudeCode() });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { ok: code === 0, out: (out + err).trim() };
}

const mergeFlags = new Map<string, string>();

async function mergeFlag(cwd: string): Promise<string> {
  const hit = mergeFlags.get(cwd);
  if (hit) return hit;
  const r = await capture(['gh', 'repo', 'view', '--json', 'squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed'], cwd);
  let flag = '--squash';
  try {
    const repo = JSON.parse(r.out) as { squashMergeAllowed: boolean; mergeCommitAllowed: boolean; rebaseMergeAllowed: boolean };
    flag = repo.squashMergeAllowed ? '--squash' : repo.mergeCommitAllowed ? '--merge' : repo.rebaseMergeAllowed ? '--rebase' : '--squash';
  } catch {
    flag = '--squash';
  }
  mergeFlags.set(cwd, flag);
  return flag;
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim() ?? '';
}

export async function perform(effect: Extract<Effect, { type: 'resume' | 'cleanup' | 'automerge' | 'ready' }>): Promise<{ ok: boolean; text: string }> {
  switch (effect.type) {
    case 'resume': {
      if (effect.stopFirst) await capture(['claude', 'stop', effect.id]);
      const r = await capture(['claude', '--bg', '--resume', effect.sessionId, '-n', effect.name, effect.prompt], effect.cwd);
      return { ok: r.ok, text: r.ok ? `${effect.label}: resumed in the background.` : `${effect.label}: ${firstLine(r.out) || 'resume failed'}` };
    }
    case 'cleanup': {
      const common = await capture(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], effect.cwd);
      const main = common.ok ? dirname(common.out.trim()) : null;
      for (const id of effect.ids.filter((x) => x !== effect.id)) await capture(['claude', 'rm', id]);
      const r = await capture(['claude', 'rm', effect.id]);
      if (!r.ok) return { ok: false, text: `${effect.label}: ${firstLine(r.out) || 'claude rm failed'}` };
      if (effect.branch && main) {
        const has = await capture(['git', 'show-ref', '--verify', '--quiet', `refs/heads/${effect.branch}`], main);
        const out = await capture(['git', 'worktree', 'list', '--porcelain'], main);
        const checkedOut = out.out.includes(`branch refs/heads/${effect.branch}\n`);
        if (has.ok && !checkedOut) await capture(['git', 'branch', '-D', effect.branch], main);
      }
      return { ok: true, text: `${effect.label}: tidied${effect.branch ? ` (session, worktree and ${effect.branch})` : ' (session and worktree)'}.` };
    }
    case 'ready': {
      const r = await capture(['gh', 'pr', 'ready', String(effect.number), ...(effect.undo ? ['--undo'] : [])], effect.cwd);
      return { ok: r.ok, text: r.ok ? `#${effect.number}: ${effect.undo ? 'back to draft' : 'ready for review'}.` : `#${effect.number}: ${firstLine(r.out) || 'gh pr ready failed'}` };
    }
    case 'automerge': {
      const args = effect.on ? ['gh', 'pr', 'merge', String(effect.number), '--auto', await mergeFlag(effect.cwd)] : ['gh', 'pr', 'merge', String(effect.number), '--disable-auto'];
      const r = await capture(args, effect.cwd);
      return { ok: r.ok, text: r.ok ? `#${effect.number}: auto-merge ${effect.on ? 'armed' : 'disarmed'}.` : `#${effect.number}: ${firstLine(r.out) || 'gh pr merge failed'}` };
    }
  }
}

async function tidy(args: string[]): Promise<void> {
  const all = args.includes('--all');
  const dry = args.includes('--dry-run');
  const rows = await loadRows(true);
  const now = Date.now();
  const picked = rows.filter((r) => {
    const t = tidyOf(r, now);
    return t === 'merged' || (all && t !== null);
  });
  if (picked.length === 0) {
    process.stdout.write(all ? 'Nothing to tidy.\n' : 'No merged sessions to tidy. --all also takes closed and stale ones.\n');
    return;
  }
  const state = { ...initialState(120, 40), rows, now };
  for (const r of picked) {
    const plan = COMMANDS.cleanup.plan(r, state);
    if (!plan.ok || plan.effect.type !== 'cleanup') continue;
    const what = `${r.key ?? r.label}\t${tidyOf(r, now)}\t${r.id}`;
    if (dry) {
      process.stdout.write(`${what}\tdry-run\n`);
      continue;
    }
    const out = await perform(plan.effect);
    process.stdout.write(`${what}\t${out.ok ? 'tidied' : 'kept'}\t${out.text}\n`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: tinker tui [--plain]\n       tinker tidy [--all] [--dry-run]\n\nA live view of Tinker’s background sessions.\n');
    return;
  }
  if (args[0] === '--tidy') return tidy(args.slice(1));

  const width = () => process.stdout.columns || 100;
  const height = () => process.stdout.rows || 30;

  if (args.includes('--plain') || !process.stdout.isTTY || !process.stdin.isTTY) {
    const state = reduce(initialState(120, 40), { type: 'rows', rows: await loadRows(), now: Date.now() }).state;
    const table = plainTable(state, Boolean(process.stdout.isTTY) && useColor());
    process.stdout.write(process.stdout.isTTY ? table : stripAnsi(table));
    return;
  }

  const term = terminal(process.stdin, process.stdout);
  let state: State = { ...initialState(width(), height(), loadSettings()), update: availableUpdate() };
  const sample = machineSampler();
  let prev: string[] | null = null;
  let busy = false;
  let paused = false;
  let done: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (done = resolve));

  const draw = () => {
    if (paused) return;
    const next = screen(state);
    process.stdout.write(diffFrame(prev, next));
    prev = next;
  };

  const dispatch = (msg: Msg) => {
    const step = reduce(state, msg);
    state = step.state;
    draw();
    for (const effect of step.effects) void run(effect);
  };

  const refresh = async (force = false) => {
    if (busy) return;
    busy = true;
    try {
      dispatch({ type: 'rows', rows: await loadRows(force), now: Date.now() });
    } catch (error) {
      dispatch({ type: 'message', text: `Could not read sessions: ${String(error)}`, tone: 'error' });
    } finally {
      busy = false;
    }
  };

  const stop = () => {
    clearInterval(timer);
    clearInterval(ticker);
    process.stdout.off('resize', onResize);
    process.stdin.off('data', onData);
    term.leave();
    done();
  };

  async function run(effect: Effect): Promise<void> {
    switch (effect.type) {
      case 'quit':
        stop();
        return;
      case 'refresh':
        await refresh(true);
        return;
      case 'open':
        openUrl(effect.url);
        return;
      case 'stop': {
        const r = await capture(['claude', 'stop', effect.id]);
        dispatch({ type: 'message', text: r.ok ? `Stopped ${effect.id}. enter attaches to resume it.` : r.out || 'stop failed', tone: r.ok ? 'info' : 'error' });
        await refresh();
        return;
      }
      case 'settings':
        try {
          saveSettings(effect.settings);
        } catch (error) {
          dispatch({ type: 'message', text: `Could not save settings: ${String(error)}`, tone: 'error' });
        }
        return;
      case 'resume':
      case 'cleanup':
      case 'ready':
      case 'automerge': {
        const r = await perform(effect);
        dispatch({ type: 'message', text: r.text, tone: r.ok ? 'info' : 'error' });
        if (effect.type !== 'resume' || !r.ok) dispatch({ type: 'done', label: effect.label });
        await refresh(true);
        return;
      }
      case 'launch': {
        const r = await capture([LAUNCHER, ...splitArgs(effect.args)]);
        const lines = r.out.split('\n').filter(Boolean).map((l) => l.split('\t').slice(0, 2).join(' '));
        dispatch({ type: 'message', text: lines.join(' · ') || (r.ok ? 'Launched.' : 'Launch failed.'), tone: r.ok ? 'info' : 'error' });
        await refresh();
        return;
      }
      case 'attach': {
        paused = true;
        term.leave();
        process.stdout.write(`\x1b[2J\x1b[H\x1b[2mAttaching to ${effect.id}. Ctrl+Z comes back to Tinker. ← opens Claude's agent view instead; Esc there also comes back.\x1b[0m\n`);
        const proc = Bun.spawn(['claude', 'attach', effect.id], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: withoutClaudeCode() });
        await proc.exited;
        term.enter();
        paused = false;
        prev = null;
        state = { ...state, width: width(), height: height() };
        draw();
        await refresh();
        return;
      }
    }
  }

  const onData = (chunk: Buffer | string) => {
    if (paused) return;
    for (const key of decode(chunk.toString())) dispatch({ type: 'key', key });
  };
  const onResize = () => {
    prev = null;
    dispatch({ type: 'resize', width: width(), height: height() });
  };

  const release = restoreOnExit(() => term.leave(), () => stop());
  term.enter();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onData);
  process.stdout.on('resize', onResize);
  draw();
  void refresh();
  const measure = async () => {
    try {
      dispatch({ type: 'machine', machine: await sample(state.rows.filter((r) => r.state !== 'done')), now: Date.now() });
    } catch {
      return;
    }
  };
  void measure();
  const timer = setInterval(() => {
    void refresh();
    void measure();
  }, POLL_MS);
  const ticker = setInterval(() => {
    state = { ...state, now: Date.now() };
    draw();
  }, 500);

  await finished;
  release();
  process.exit(0);
}

if (import.meta.main) void main();
