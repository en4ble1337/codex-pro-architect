#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${CODEX_PRO_ARCHITECT_REPO_URL:-https://github.com/en4ble1337/codex-pro-architect.git}"
INSTALL_DIR="${CODEX_PRO_ARCHITECT_INSTALL_DIR:-$HOME/.local/share/codex-pro-architect}"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js 20+ is required" >&2; exit 1; }

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

npm install --global "$INSTALL_DIR"

echo
printf 'Installed codex-pro-architect. Next:\n\n'
printf '  read -rsp "OpenAI API key: " OPENAI_API_KEY; echo\n'
printf '  export OPENAI_API_KEY\n'
printf '  codex-pro-architect setup\n'
printf '  unset OPENAI_API_KEY\n\n'
printf 'Then restart Codex and type: $pro-architect status\n'
