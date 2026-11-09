<p align="center"><img src="assets/tinker.png" alt="Little Tinker" width="160"></p>

# Little Tinker

Point it at a list of tickets and come back to draft PRs that have already been reviewed, each with
its decisions written down. It's all native Claude Code sessions, so there's nothing new to run or
trust.

```bash
/tinker ABC-101 ABC-102 #42 "the export button 500s on empty carts"
```

Each issue becomes one `claude --bg --agent tinker:tinker` session that ends at a pushed branch and a
draft PR, or parks with a question for you.

![tinker tui: sessions grouped by what needs you, with each one's PR, CI and verdict](assets/tui.png)

<sub>`tinker tui`, shown with mock data.</sub>

## Why Tinker, and not just Claude's own orchestration?

Tinker doesn't replace Claude Code's orchestration. It sits on top of it. Every worker is a plain
background session (`claude --bg`), `claude agents` lists them and `claude attach <id>` joins one.
Tinker keeps no state of its own. It adds a worker contract and a live view for the
issue-to-draft-PR job.

### What it adds over raw `claude --bg`

1. **A fixed contract for each worker** ([`agents/tinker.md`](agents/tinker.md)). Each session follows
   the same steps: triage, a fresh worktree, a failing test first, the smallest fix,
   lint/typecheck/test, a draft PR, then a self-review of at most three rounds. A bare
   `claude --bg "fix ABC-101"` does whatever the model decides that day.
2. **Guardrails for unattended runs.** Workers can't write to the tracker, can't merge or mark a PR
   ready, can't force-push, and can't touch production, secrets or CI. They get two retries at most
   before stopping. That's what makes it safe to fire off eight sessions and walk away.
3. **"Park" instead of stalling.** A worker only stops for money, legal text, production data,
   credentials, customer-facing copy or a fact only you know. Every other call it makes is recorded
   under *Decisions* in the PR. A parked session leaves its question and a recommendation, and you
   answer with `claude attach`.
4. **A result you can read by machine.** Every worker ends with `TINKER DONE <pr> P0= P1= P2=` or
   `TINKER PARKED <class> …`. The six park classes (`missing-decision`, `dependency-wait`, `base-red`,
   `application-defect`, `review-blocked`, `agent-mistake`) tell you whether the blocker is you, the
   base branch, the app or the agent itself.
5. **One command for many issues.** It accepts Jira keys, `#42`, issue URLs or plain descriptions. It
   handles `TINKER_KEY_PREFIX`, drops duplicates, skips issues that already have a live 🐙 session,
   applies one shared `--note`, and has `--dry-run`. It asks for confirmation above eight issues.
6. **A TUI that shows the work, not just the processes.** `claude agents` lists sessions.
   `tinker tui` groups them by what needs you and joins each one to its PR, draft state, CI result and
   the worker's final line.
7. **Very little code.** A short bash launcher, a one-page prompt and a small Bun TUI. With no daemon
   or database, nothing can drift out of sync with Claude Code, and native improvements come for
   free.

### Compared with the other options

| Option | Best for | Where Tinker wins |
|---|---|---|
| Subagents / Workflow tool | Splitting work inside one session | Tinker sessions are separate, outlive your terminal, can be attached to one by one, and don't fill your main session's context |
| Bare `claude --bg` | One-off background jobs | Contract, guardrails, dedupe, verdicts, PR/CI view |
| Epic orchestrators (e.g. Portia) | One epic that needs waves of work on an integration branch | Tinker is lighter for *unrelated* tickets, with one PR per issue |
| Loop runners (e.g. Ralph) | Long iterative loops with a planned task list | Tinker is fire-and-forget per issue, with nothing to set up |

### Known limits

- **Issues are assumed independent.** Nothing handles ordering, shared files or merge conflicts
  between workers. Use an epic orchestrator for that case.
- **PRs are found by searching for the issue key in titles.** Description-based issues don't link to
  a PR in `tinker status`.
- **Dedupe goes by session name** and only covers live sessions, so relaunching a finished issue
  opens a second PR.
- **Cost control is limited.** The only brake is the confirmation above eight issues. There's no
  token or time budget per worker.
- **Issue text is untrusted input.** Workers run unattended with your permissions, and they read
  whatever the issue's author wrote. The contract tells them to treat it as a description, not as
  instructions, but that is a prompt and not a sandbox. On a public repo, only point Tinker at
  issues you have read yourself.

## Install

In Claude Code:

```bash
/plugin marketplace add mousedown/tinker
/plugin install tinker@tinker
```

To get the `tinker` command in your shell too, link the launcher onto your `PATH`, for example
`ln -s ~/.claude/plugins/marketplaces/tinker/bin/tinker ~/.local/bin/tinker`.

## Usage

```bash
tinker <issue>... [--note "text"] [--repo PATH] [--dry-run]
tinker status [--all]
tinker tui [--plain]
tinker tidy [--all] [--dry-run]
```

### In the TUI

Tick sessions, then act on all of them at once. With nothing ticked, a command acts on the
highlighted row. Each command asks y/n once, names what it skips and why, then resumes each worker in
the background with `claude --bg --resume`, so it keeps its context. The row shows a spinner and what
it is doing until the new session starts or the action finishes, and the resumed session takes the
old one's place in the list (`f` shows every session).

| Key | Does |
|---|---|
| `space` / `*` / `t` / `u` | Tick a row / its whole group / everything to tidy / clear ticks |
| `p` | **Prepare** the ticked PRs with `/tinker:prepare`: merge the base in, run checks, push, review at the final head, rewrite the description, mark ready |
| `c` | **Clean up**: `claude rm` the session and its worktree, and delete the local branch if the PR merged |
| `m` | **Menu** of everything below for the ticked rows: prepare, mark ready, back to draft, fix CI, update, arm or disarm auto-merge, clean up, relaunch. ↑↓ and enter, or press the item's letter |
| `D` / `M` / `T` | Sticky toggles: **stop at draft**, **auto-merge** after prepare, **auto-tidy** merged sessions |
| `o` / `i` | Open the PR / the failing check (both are also ctrl/cmd-clickable in the table) |
| `enter`, `a` | Open the detail view (worker output rendered as markdown) / attach |

Rows whose PR merged or closed, or that ended over a week ago without a PR, show `⌫` and are counted in
the header. With auto-tidy on, merged ones are cleaned as soon as they appear; `tinker tidy` does the
same from a cron job or hook, and `--all` adds the closed and stale ones. `claude rm` refuses anything
with unpushed work. The toggles live in `~/.config/tinker/settings.json` (or `TINKER_SETTINGS`).

When you attach from the TUI, Ctrl+Z comes back to it. ← opens Claude's agent view instead, and Esc
there also comes back.

| Variable | Effect |
|---|---|
| `TINKER_REPO` | Repo to launch in (default: the current git checkout) |
| `TINKER_KEY_PREFIX` | Makes a bare number mean `<PREFIX>-<n>` instead of a GitHub issue |
| `TINKER_REVIEW` | Self-review command, e.g. `/my-review --fix` (default: Claude Code's built-in `/code-review --fix`, or whatever the repo's CLAUDE.md names) |
| `TINKER_AGENT` | Worker agent (default `tinker:tinker`) |
| `TINKER_LINKS=0` | Turns off clickable PR and CI links for a terminal that prints them raw |

Requires `claude`, `gh`, `jq`, and `bun` for the TUI.

## Development

```bash
bun install
bun run typecheck
bun test
```

## License

[MIT](LICENSE)
