#!/usr/bin/env bun
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  issueKey,
  labelOf,
  prFor,
  pulls,
  sessions,
  transcript,
  withoutClaudeCode,
  type Pr,
  type Row,
} from './data';
import { decode } from './runtime/keys';
import { openUrl, restoreOnExit, terminal } from './runtime/tty';
import { diffFrame } from './runtime/writer';
import { stripAnsi } from './render/text';
import { useColor } from './render/theme';
import { initialState, reduce, type Effect, type Msg, type State } from './state';
import { plainTable, screen } from './view';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = join(ROOT, 'bin', 'tinker');
const POLL_MS = 2000;
const PR_MS = 20000;

const prCache = new Map<string, { at: number; prs: Pr[] }>();

async function prsFor(cwd: string, force: boolean): Promise<Pr[]> {
  const hit = prCache.get(cwd);
  if (hit && !force && Date.now() - hit.at < PR_MS) return hit.prs;
  const prs = await pulls(cwd);
  prCache.set(cwd, { at: Date.now(), prs });
  return prs;
}

export async function loadRows(force = false): Promise<Row[]> {
  const list = await sessions(true);
  const cwds = [...new Set(list.map((s) => s.cwd))];
  const prs = new Map(await Promise.all(cwds.map(async (c) => [c, await prsFor(c, force)] as const)));
  return list.map((s) => {
    const { verdict, said } = transcript(s);
    const key = issueKey(s.name);
    return { ...s, key, label: labelOf(s.name), verdict, said, pr: prFor(key, prs.get(s.cwd) ?? [], verdict) };
  });
}

function splitArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

async function capture(cmd: string[]): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: withoutClaudeCode() });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { ok: code === 0, out: (out + err).trim() };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: tinker tui [--plain]\n\nA live view of Tinker’s background sessions.\n');
    return;
  }

  const width = () => process.stdout.columns || 100;
  const height = () => process.stdout.rows || 30;

  if (args.includes('--plain') || !process.stdout.isTTY || !process.stdin.isTTY) {
    const state = reduce(initialState(120, 40), { type: 'rows', rows: await loadRows(), now: Date.now() }).state;
    const table = plainTable(state, Boolean(process.stdout.isTTY) && useColor());
    process.stdout.write(process.stdout.isTTY ? table : stripAnsi(table));
    return;
  }

  const term = terminal(process.stdin, process.stdout);
  let state: State = initialState(width(), height());
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
        process.stdout.write(`\x1b[2J\x1b[H\x1b[2mAttaching to ${effect.id}. Ctrl+Z or ← to come back to Tinker.\x1b[0m\n`);
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
  const timer = setInterval(() => void refresh(), POLL_MS);

  await finished;
  release();
  process.exit(0);
}

if (import.meta.main) void main();
