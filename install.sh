#!/usr/bin/env bash
# Copyright 2026 Ix Infrastructure Inc.


set -euo pipefail

REPO="${IX_CURSOR_REPO:-ix-infrastructure/ix-cursor-plugin}"
PLUGIN_NAME="${IX_CURSOR_PLUGIN_NAME:-ix-memory}"
CURSOR_LOCAL_ROOT="${HOME}/.cursor/plugins/local"
DEST_DIR="${CURSOR_LOCAL_ROOT}/${PLUGIN_NAME}"

# What to install:
#   IX_CURSOR_VERSION=1.2.3   the release tag v1.2.3 (a leading "v" is accepted)
#   IX_CURSOR_REF=<ref>       a branch name, a full ref (refs/tags/..., refs/heads/...)
#                             or a full 40-character commit sha
# With neither set, the tip of the main branch, as before.
VERSION="${IX_CURSOR_VERSION:-}"
REF="${IX_CURSOR_REF:-}"

if [[ -n "${VERSION}" && -n "${REF}" ]]; then
  echo "Error: set IX_CURSOR_VERSION or IX_CURSOR_REF, not both." >&2
  exit 1
fi

if [[ -n "${VERSION}" ]]; then
  VERSION="${VERSION#v}"
  if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
    echo "Error: IX_CURSOR_VERSION must be a version such as 1.2.3, got '${IX_CURSOR_VERSION}'." >&2
    exit 1
  fi
  REF="refs/tags/v${VERSION}"
elif [[ -z "${REF}" ]]; then
  REF="main"
fi

# A bare name is a branch, as IX_CURSOR_REF always meant; a full ref or a full
# sha is passed through.
if [[ "${REF}" == refs/* || "${REF}" =~ ^[0-9a-f]{40}$ ]]; then
  ARCHIVE_REF="${REF}"
else
  ARCHIVE_REF="refs/heads/${REF}"
fi
ARCHIVE_URL="https://codeload.github.com/${REPO}/tar.gz/${ARCHIVE_REF}"

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

# mcp.json points Cursor straight at `ix mcp --tools=all`. `ix mcp` only exists
# from 0.9.3 and `--tools` from 0.11.0. On an older CLI the registration is
# accepted and then fails at spawn ("unknown command 'mcp'" or "unknown option
# '--tools=all'") — Cursor surfaces that as a generic connection failure, which
# says nothing about needing an upgrade. Refuse here instead, where there is
# somewhere to print the reason.
MIN_IX_VERSION="0.11.0"
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
if ! curl -fsSL "${ARCHIVE_URL}" -o "${TMP_DIR}/plugin.tar.gz"; then
  echo "Error: could not download ${ARCHIVE_URL}" >&2
  echo "Check that ${REF} exists in ${REPO} (IX_CURSOR_VERSION / IX_CURSOR_REF)." >&2
  exit 1
fi

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

# The version the manifest declares is what this install reports. CI keeps it
# equal to mcp/package.json.
INSTALLED_VERSION="$(node -e '
  const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version;
  process.stdout.write(typeof v === "string" ? v : "");
' "${EXTRACTED_DIR}/.cursor-plugin/plugin.json" 2>/dev/null || true)"
INSTALLED_VERSION="${INSTALLED_VERSION:-unknown}"

if [[ -n "${VERSION}" && "${INSTALLED_VERSION}" != "${VERSION}" ]]; then
  echo "Warning: asked for ${VERSION}, but ${REF} declares version ${INSTALLED_VERSION} in .cursor-plugin/plugin.json." >&2
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

# The committed mcp/dist runs on Node alone (the package has no runtime
# dependencies), so npm is needed only to build it when it is absent.
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
echo "  ${PLUGIN_NAME} ${INSTALLED_VERSION} from ${REPO}@${REF}"
echo "  ${DEST_DIR}"
if [[ "${ARCHIVE_REF}" == refs/heads/* ]]; then
  echo "  (${REF} is a branch: this is its current tip, not a pinned release."
  echo "   Set IX_CURSOR_VERSION to install a tagged release.)"
fi
echo
echo "Next step:"
echo "  Restart Cursor or reload plugins so it picks up the new install."
