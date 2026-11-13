---
name: tinker
description: Little Tinker. Fixes issues individually or in bulk, each as a native background Claude session (agent tinker:tinker) that ends at a pushed branch and a draft PR, self-reviewed before it stops. Use for "/tinker ABC-101 ABC-102", "/tinker #42", "tinker these", "fix these tickets", "fan these out", "kick off ABC-…", a pasted list of tracker keys or GitHub issues, or "/tinker status" / "how are the tinker sessions doing".
argument-hint: "<ABC-123 | 42 | issue-url | \"description\">... [--note \"text\"] [--repo PATH] | status [--all]"
---

# Little Tinker

One background session per issue. The orchestration is Claude Code's own: `claude --bg` launches,
`claude agents` is the live view, `claude attach <id>` joins one. Little Tinker adds the worker contract
(`agents/tinker.md`) and this launcher; it keeps no state of its own.

## Launch

```bash
${CLAUDE_PLUGIN_ROOT}/bin/tinker ABC-101 ABC-102 --note "Add an integration test for the fix."
```

- Bare numbers (`42`, `#42`) are GitHub issues, or `<PREFIX>-<n>` when `TINKER_KEY_PREFIX` is set; issue URLs, tracker links (taken as their key) and quoted descriptions work too. A bare word or a session id is refused and nothing in the batch launches.
- Each worker has a 120-minute budget (`TINKER_MAX_MINUTES`, 0 for none) and parks as `over-budget` past it.
- Skips any issue a live Little Tinker session (name starting `🐙`) already has.
- Runs in the current git checkout unless `--repo PATH` (or `TINKER_REPO`) says otherwise.
- Anything the user adds after the issues ("use TDD", "keep it small") goes in `--note` as one
  clear sentence. Never pass those words as issues.
- `--dry-run` prints the commands without launching.
- Self-review uses Claude Code's built-in `/code-review --fix` unless `TINKER_REVIEW` names another
  command (e.g. `TINKER_REVIEW="/my-review --fix"`) or the repo's CLAUDE.md does.

Launch straight away for up to eight issues. Above eight, confirm the count once first: each session
spends tokens.

Then restate each issue, its result and session id as a table, and remind the user:
`claude agents` shows them live, `claude attach <id>` answers a parked one.

## Status

```bash
${CLAUDE_PLUGIN_ROOT}/bin/tinker status          # live sessions
${CLAUDE_PLUGIN_ROOT}/bin/tinker status --all    # include finished ones
```

Restate the table. For a session in `blocked` state, say it is waiting on the user and how to
attach. A finished worker's verdict is the last line of its session, `TINKER DONE …` or
`TINKER PARKED <class> …`, and its last message opens with `tinker-status: <green | awaiting-approval |
ci-failing | blocked> <reason>`: say which ones only wait on an approval and which have red CI.

## Live view

`${CLAUDE_PLUGIN_ROOT}/bin/tinker tui` is the terminal UI: every Tinker session grouped by what needs
you, its PR and CI, and the worker's verdict. It needs a real terminal, so tell the user to run it
themselves (`! tinker tui` does not work: it is interactive).

In the TUI, space ticks sessions and `p` (prepare), `c` (clean up) or the `m` menu (mark ready, back to
draft, fix CI, update, arm or disarm auto-merge, relaunch) act on all of them; `D`, `M` and `T` toggle stop-at-draft, auto-merge
and auto-tidy. To tidy merged sessions without the TUI:

```bash
${CLAUDE_PLUGIN_ROOT}/bin/tinker tidy --dry-run   # what would go
${CLAUDE_PLUGIN_ROOT}/bin/tinker tidy             # merged PRs' sessions, worktrees and branches
${CLAUDE_PLUGIN_ROOT}/bin/tinker tidy --all       # also closed PRs and week-old sessions with no PR
```

Show the dry run and get a yes before running a real tidy for the user.
