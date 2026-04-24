#!/usr/bin/env bash

set -euo pipefail

PLUGIN_NAME="${IX_CURSOR_PLUGIN_NAME:-ix-memory}"
DEST_DIR="${HOME}/.cursor/plugins/local/${PLUGIN_NAME}"

if [[ -L "${DEST_DIR}" || -d "${DEST_DIR}" ]]; then
  rm -rf "${DEST_DIR}"
  echo "Removed ${DEST_DIR}"
else
  echo "No install found at ${DEST_DIR}"
fi
