#!/usr/bin/env bash

set -euo pipefail

REPO="${IX_CURSOR_REPO:-ix-infrastructure/ix-cursor-plugin}"
REF="${IX_CURSOR_REF:-main}"
PLUGIN_NAME="${IX_CURSOR_PLUGIN_NAME:-ix-memory}"
CURSOR_LOCAL_ROOT="${HOME}/.cursor/plugins/local"
DEST_DIR="${CURSOR_LOCAL_ROOT}/${PLUGIN_NAME}"
ARCHIVE_URL="https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command not found: $1" >&2
    exit 1
  fi
}

echo "Installing ${PLUGIN_NAME} from ${REPO}@${REF}"

need_cmd curl
need_cmd tar
need_cmd node

if ! command -v ix >/dev/null 2>&1; then
  echo "Error: 'ix' is not available on PATH." >&2
  echo "Install ix first, then rerun this installer." >&2
  exit 1
fi

# mcp.json points Cursor straight at `ix mcp`, which only exists from 0.9.3. On
# an older CLI the registration is accepted and then fails at spawn with
# "unknown command 'mcp'" — Cursor surfaces that as a generic connection
# failure, which says nothing about needing an upgrade. Refuse here instead,
# where there is somewhere to print the reason.
MIN_IX_VERSION="0.9.3"
IX_VERSION="$(ix --version 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"

if [[ -z "${IX_VERSION}" ]]; then
  # Unreadable is not the same as too old: a version this script cannot parse
  # is not grounds for blocking an install that may well work.
  echo "Warning: could not read the ix version; ${PLUGIN_NAME} needs ix >= ${MIN_IX_VERSION}." >&2
elif [[ "$(printf '%s\n%s\n' "${MIN_IX_VERSION}" "${IX_VERSION}" | sort -V | head -n 1)" != "${MIN_IX_VERSION}" ]]; then
  echo "Error: ${PLUGIN_NAME} needs ix >= ${MIN_IX_VERSION}, found ${IX_VERSION}." >&2
  echo "This plugin serves its tools from the CLI's own MCP server ('ix mcp')," >&2
  echo "which older versions do not have. Run 'ix upgrade', then rerun this installer." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

mkdir -p "${CURSOR_LOCAL_ROOT}"

echo "Downloading archive..."
curl -fsSL "${ARCHIVE_URL}" -o "${TMP_DIR}/plugin.tar.gz"

echo "Extracting archive..."
tar -xzf "${TMP_DIR}/plugin.tar.gz" -C "${TMP_DIR}"

EXTRACTED_DIR="$(find "${TMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "${EXTRACTED_DIR}" ]]; then
  echo "Error: could not find extracted plugin directory." >&2
  exit 1
fi

if [[ ! -f "${EXTRACTED_DIR}/.cursor-plugin/plugin.json" ]]; then
  echo "Error: extracted archive does not contain .cursor-plugin/plugin.json." >&2
  echo "Check REPO and REF, or override them with IX_CURSOR_REPO / IX_CURSOR_REF." >&2
  exit 1
fi

if [[ -L "${DEST_DIR}" ]]; then
  echo "Removing existing symlink at ${DEST_DIR}"
  rm "${DEST_DIR}"
elif [[ -d "${DEST_DIR}" ]]; then
  echo "Replacing existing install at ${DEST_DIR}"
  rm -rf "${DEST_DIR}"
elif [[ -e "${DEST_DIR}" ]]; then
  echo "Error: ${DEST_DIR} exists and is not a directory or symlink." >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"
cp -R "${EXTRACTED_DIR}/." "${DEST_DIR}/"

if [[ ! -d "${DEST_DIR}/mcp/node_modules" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is required because mcp/node_modules is missing (the hooks are built from mcp/)." >&2
    exit 1
  fi
  echo "Installing hook build dependencies..."
  (
    cd "${DEST_DIR}/mcp"
    npm ci --omit=dev
  )
fi

if [[ ! -f "${DEST_DIR}/mcp/dist/hooks/prompt-briefing.js" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is required because mcp/dist/hooks are missing." >&2
    exit 1
  fi
  echo "Building hooks..."
  (
    cd "${DEST_DIR}/mcp"
    npm ci
    npm run build
  )
fi

echo
echo "Installed Cursor plugin:"
echo "  ${DEST_DIR}"
echo
echo "Next step:"
echo "  Restart Cursor or reload plugins so it picks up the new install."
