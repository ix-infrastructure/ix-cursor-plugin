#!/usr/bin/env bash
# install-local.sh — Register the local ix-cursor-plugin as a Cursor local plugin.
#
# Usage: ./install-local.sh
#
# This script links the current checkout into Cursor's local plugin directory:
#   ~/.cursor/plugins/local/ix-memory
#
# Safe to re-run. It will replace an existing symlink that already points at a
# local checkout, but it will not delete a real directory at the target path.

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="ix-memory"
CURSOR_LOCAL_ROOT="${HOME}/.cursor/plugins/local"
TARGET_PATH="${CURSOR_LOCAL_ROOT}/${PLUGIN_NAME}"
MANIFEST_PATH="${PLUGIN_DIR}/.cursor-plugin/plugin.json"

echo "Plugin directory : ${PLUGIN_DIR}"
echo "Target path      : ${TARGET_PATH}"

if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "Error: ${MANIFEST_PATH} not found."
  echo "This checkout does not look like a valid Cursor plugin root."
  exit 1
fi

mkdir -p "${CURSOR_LOCAL_ROOT}"

if [[ -L "${TARGET_PATH}" ]]; then
  rm "${TARGET_PATH}"
elif [[ -e "${TARGET_PATH}" ]]; then
  echo "Error: ${TARGET_PATH} already exists and is not a symlink."
  echo "Move or remove it manually, then rerun this script."
  exit 1
fi

ln -s "${PLUGIN_DIR}" "${TARGET_PATH}"

echo ""
echo "Registered local Cursor plugin:"
echo "  ${PLUGIN_NAME} -> ${PLUGIN_DIR}"
echo ""
echo "Next step:"
echo "  Restart Cursor or reload plugins so it picks up the local checkout."
