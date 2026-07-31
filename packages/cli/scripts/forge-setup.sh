#!/usr/bin/env bash
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
YES=false
NO_CONFIG=false
NO_GITIGNORE=false
CWD="$(pwd)"

# ── Parse flags ───────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=true; shift ;;
    --no-config) NO_CONFIG=true; shift ;;
    --no-gitignore) NO_GITIGNORE=true; shift ;;
    --cwd) CWD="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Resolve script directory ──────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULTS_DIR="$(dirname "$SCRIPT_DIR")/defaults"

# ── Colours ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ── Helpers ───────────────────────────────────────────────────────────
log_info()  { echo -e "${GREEN}[forge]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[forge]${NC} $*"; }
log_error() { echo -e "${RED}[forge]${NC} $*"; }

# ── Check prerequisites ────────────────────────────────────────────────
check_prereqs() {
  local failures=0

  if ! command -v git &>/dev/null; then
    log_error "git is not available — please install git"
    failures=$((failures + 1))
  fi

  if ! git rev-parse --git-dir &>/dev/null; then
    log_error "not inside a git worktree — run from a git repository"
    failures=$((failures + 1))
  fi

  if ! command -v pi &>/dev/null; then
    log_error "pi CLI is not available — please install @earendil-works/pi-coding-agent"
    failures=$((failures + 1))
  fi

  local node_version
  node_version="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  if [[ -z "$node_version" ]] || [[ "$node_version" -lt 22 ]]; then
    log_error "Node.js >= 22 is required (found: ${node_version:-none})"
    failures=$((failures + 1))
  fi

  return "$failures"
}

# ── Scaffold .forge/config.json ───────────────────────────────────────
scaffold_config() {
  local target="$CWD/.forge/config.json"
  if [[ -f "$target" ]]; then
    log_warn ".forge/config.json already exists — skipping"
    return 0
  fi
  mkdir -p "$CWD/.forge"
  cp "$DEFAULTS_DIR/forge.config.json" "$target"
  log_info "created .forge/config.json"
}

# ── Create runtime directories ─────────────────────────────────────────
create_dirs() {
  mkdir -p "$CWD/.forge/logs" "$CWD/.forge/worktrees"
  log_info "created .forge/logs and .forge/worktrees"
}

# ── Append gitignore entries ───────────────────────────────────────────
append_gitignore() {
  local gitignore="$CWD/.gitignore"
  local sentinel="# Feature Forge runtime"
  if [[ -f "$gitignore" ]] && grep -qF "$sentinel" "$gitignore" 2>/dev/null; then
    log_info ".gitignore already contains forge entries — skipping"
    return 0
  fi
  if [[ ! -f "$gitignore" ]]; then
    touch "$gitignore"
  fi
  {
    echo ""
    echo "$sentinel"
    echo ".forge/*"
    echo "!.forge/config.json"
    echo "!.forge/skills/"
    echo "!.forge/skills/**"
    echo "coverage-single/"
    echo ""
    echo "# pi coding agent runtime"
    echo ".pi"
    echo ""
    echo "# Environment overrides"
    echo ".env"
    echo ".env.local"
  } >> "$gitignore"
  log_info "appended forge entries to .gitignore"
}

# ── Main ───────────────────────────────────────────────────────────────
main() {
  mkdir -p "$CWD"
  check_prereqs || {
    log_error "prerequisite checks failed — aborting"
    exit 1
  }

  if [[ "$NO_CONFIG" != "true" ]]; then
    scaffold_config
  fi

  create_dirs

  if [[ "$NO_GITIGNORE" != "true" ]]; then
    append_gitignore
  fi

  log_info "Feature Forge initialized successfully in $CWD"
}

main
