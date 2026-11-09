#!/usr/bin/env bash
# Little Tinker installer. Safe to re-run: it updates whatever is already there.
#
#   curl -fsSL https://raw.githubusercontent.com/mousedown/tinker/main/install.sh | bash
#
# TINKER_SOURCE   marketplace source (default mousedown/tinker; a local path works for development)
# TINKER_BIN_DIR  where the `tinker` launcher is linked (default ~/.local/bin)
set -euo pipefail

SOURCE="${TINKER_SOURCE:-mousedown/tinker}"
BIN_DIR="${TINKER_BIN_DIR:-$HOME/.local/bin}"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v claude >/dev/null || die "Claude Code isn't installed: https://docs.claude.com/en/docs/claude-code"
command -v jq >/dev/null || die "jq isn't installed (brew install jq, or see https://jqlang.org)"
command -v gh >/dev/null || warn "GitHub CLI isn't installed; workers need it to read issues and open PRs (https://cli.github.com)"
command -v gh >/dev/null && ! gh auth status >/dev/null 2>&1 && warn "GitHub CLI isn't logged in; run: gh auth login"
command -v bun >/dev/null || warn "Bun isn't installed; only 'tinker tui' needs it (https://bun.sh)"

# A local directory is resolved to an absolute path so the marketplace keeps pointing at it.
[ -d "$SOURCE" ] && SOURCE="$(cd "$SOURCE" && pwd)"

if claude plugin marketplace list --json | jq -e '.[] | select(.name == "tinker")' >/dev/null; then
  say "Updating the tinker marketplace"
  claude plugin marketplace update tinker
else
  say "Adding the tinker marketplace ($SOURCE)"
  claude plugin marketplace add "$SOURCE"
fi

if claude plugin list --json | jq -e '.[] | select(.id == "tinker@tinker")' >/dev/null; then
  say "Updating the tinker plugin"
  claude plugin update tinker@tinker
else
  say "Installing the tinker plugin"
  claude plugin install tinker@tinker
fi

# Link the marketplace checkout, not cache/<version>: the cache moves on every update.
# installLocation already honours CLAUDE_CONFIG_DIR, so no path is guessed here.
market="$(claude plugin marketplace list --json | jq -r '.[] | select(.name == "tinker") | .installLocation // empty')"
[ -n "$market" ] && [ -x "$market/bin/tinker" ] || die "Can't find bin/tinker in the tinker marketplace ($market)"

mkdir -p "$BIN_DIR"
ln -sf "$market/bin/tinker" "$BIN_DIR/tinker"
say "Linked $BIN_DIR/tinker -> $market/bin/tinker"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    case "$(basename "${SHELL:-}")" in
      zsh) profile="$HOME/.zshrc" ;;
      bash) profile="$HOME/.bashrc" ;;
      *) profile="$HOME/.profile" ;;
    esac
    line="export PATH=\"$BIN_DIR:\$PATH\""
    if ! grep -qsF "$line" "$profile"; then
      printf '\n# Added by the Little Tinker installer\n%s\n' "$line" >>"$profile"
      say "Added $BIN_DIR to PATH in $profile"
    fi
    warn "Open a new terminal (or run: source $profile) before using 'tinker'"
    ;;
esac

say "Done. Restart Claude Code (or run /reload-plugins) to load /tinker, then try: tinker --help"
