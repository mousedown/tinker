---
name: prepare
description: Take a finished branch to a submitted PR in any repository - bring the base in, run the repo's checks, refresh docs the repo generates, push, review at the final head, rewrite the PR description, then mark it ready (or leave it as a draft) and optionally arm auto-merge. Use for "/tinker:prepare", "prepare this PR", or when the Tinker TUI resumes a worker with it. Flags --draft, --auto-merge, --review "<command>", --dry-run.
---

# Prepare

Takes the branch this session is working on from "the code is done" to "a reviewer can merge it".
It is repository-agnostic: every command, convention and gate comes from the repo itself (its
CLAUDE.md, AGENTS.md, CONTRIBUTING, package scripts, Makefile and CI workflows), never from memory of
another repo.

Running this skill is the go-ahead for everything below, including marking the PR ready and, with
`--auto-merge`, arming auto-merge. In a Little Tinker worker it overrides the contract's "never mark
ready" for this run only; the contract's other rules still hold.

```
preflight → merge base in → checks → generated docs → commit + push → PR exists
  → review at the final head → PR description → ready (or draft) → auto-merge
```

## Flags

| Flag | Effect |
|---|---|
| `--draft` | Stop at draft: do everything except `gh pr ready` and auto-merge |
| `--auto-merge` | After ready, arm auto-merge with the repo's allowed merge method |
| `--review "<cmd>"` | Review command to run; else `TINKER_REVIEW`; else the one the repo's CLAUDE.md names; else `/code-review --fix` |
| `--dry-run` | Phases 0–3 read-only, then print what it would do; write nothing to the branch or GitHub |
| `for PR #N on branch B` | Which PR and branch; otherwise the current branch's PR |

## The ordering rule

**Nothing may create a commit after the review.** A review is evidence about one head SHA; a docs
refresh or lint fix committed after it leaves the review describing code that is no longer there,
and repos that gate merges on a review at the head will block. So anything that writes to the branch
happens before the review, and only GitHub API writes (PR body, ready, auto-merge) come after.

## Phase 0 — Preflight

1. **Get onto the branch.** If a PR or branch was named, work in its worktree (`git worktree list`);
   enter it if this session is elsewhere. Refuse on the default branch or any protected or
   integration branch the repo's docs name.
2. **Resolve the base from the PR, never assume `main`:** `gh pr view --json number,baseRefName,isDraft,url,state`.
   No PR yet: the repo's default branch (`gh repo view --json defaultBranchRef`).
3. **Install if the worktree is fresh**, with the repo's package manager (the lockfile says which). A
   worktree without dependencies can resolve packages from the parent checkout and fail misleadingly.
4. **Learn the repo's rules:** read CLAUDE.md / AGENTS.md / CONTRIBUTING for the check commands, title
   format, branch rules and anything that must happen before a PR. Read `.github/workflows/` to see
   what CI will run and which checks are required.

## Phase 1 — Bring the base in

```bash
git fetch origin <base> && git merge --no-edit origin/<base>
```

Merge, never rebase: the branch may already be under review, and a rebase needs a force-push.
**Conflicts stop the skill** unless they are mechanical with both sides' intent clear (a lockfile, a
generated file, adjacent additions). Otherwise `git merge --abort` and report the conflicted paths.

## Phase 2 — Checks

Run what the repo says to run before a PR: its lint, typecheck, test and build scripts, or the steps
its CI runs. Read exit codes, not output. Fix what this branch broke. A failure that reproduces on
the base is not this branch's: say so and move on rather than folding an unrelated fix in.

## Phase 3 — Generated docs and knowledge

Only if the repo has them. If a generator's inputs changed (a schema, an API router, env vars) and
the repo has a refresh command, run it. If the repo keeps a knowledge base or docs its CLAUDE.md asks
to keep in step, check whether this diff moved any claim in it and patch only those. "Nothing moved"
is the normal outcome; never invent a change to look productive, and never hand-edit a file marked
as generated.

## Phase 4 — Commit and push

One commit per phase that produced changes, in the repo's commit format. Remove scratch files
(screenshots, tool output) first and confirm with `git status`. No AI attribution in commits. Push
the branch with `git push -u origin HEAD`. Never force-push, never `--no-verify`.

## Phase 5 — A PR exists

If there is none, `gh pr create --draft --base <base> --title "<title>" --body "<short summary>"`,
always passing `--title` in the repo's format. To fix a bad title, edit it; renaming the branch
closes the PR.

## Phase 6 — Review at the final head

Note `git rev-parse HEAD`, then run the review command (see Flags) on the PR, posting to the PR when
the command can. Fix every P0 and P1 it finds, commit, push and re-review the fix delta, for at most
three rounds in total. Each fix moves the head, so the last review must be at the head you finish on.
If a P0 or P1 is still open after round three, leave the PR as a draft, skip phases 8 and 9, and say
so.

## Phase 7 — PR description

Rewrite the body from the whole diff against the merge base: what changed and why, how it was
verified, decisions taken without asking, P2s left and any acceptance criteria not met. Keep images
and anything else a person added. Follow the repo's PR template if it has one.

## Phase 8 — Ready

Skip with `--draft`. Otherwise `gh pr ready <n>`.

## Phase 9 — Auto-merge

Only with `--auto-merge`, and only after phase 8. Pick the method the repo allows
(`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`, preferring squash)
and run `gh pr merge <n> --auto --<method>`. If the repo has auto-merge disabled, say so and leave it.

## Report

The PR URL and base, what each phase changed or "nothing to do", the review's verdict at the final
head, whether the PR is ready or a draft, and whether auto-merge is armed. Watch CI with
`gh pr checks <n> --watch` and name the first failure if there is one. In a Tinker worker, treat a red
check as the contract's CI stage says (a fix moves the head, so review the fix delta again), begin the
report with its `tinker-status:` line and end with its `TINKER DONE …` or `TINKER PARKED …` line.

## Guardrails

- Never push to the default or a protected branch, force-push, or merge directly; auto-merge leaves
  the merge to GitHub once required checks pass.
- Never skip hooks, forge a review marker, or mark a check as passed by hand.
- A phase that fails in a way you cannot honestly fix stops the skill: report which phase, what
  failed and what the author needs to decide. A partial prepare reported as done is worse than a
  stopped one.
