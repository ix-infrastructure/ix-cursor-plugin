import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { redactSecrets } from "../shared/secrets.js";

export const ERROR_LOG_PATH = join(
  homedir(),
  ".local",
  "share",
  "ix",
  "cursor-plugin",
  "errors",
  "errors.jsonl",
);

export type ErrorCode =
  | "IX_NOT_FOUND"
  | "TIMEOUT"
  | "PARSE_FAILURE"
  | "VALIDATION"
  | "PERMISSION_DENIED"
  | "UNKNOWN";

export class IxError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IxError";
  }
}

function redact(text: string): string {
  const home = process.env["HOME"] ?? "__NO_HOME__";
  return redactSecrets(text).replaceAll(new RegExp(home, "g"), "~");
}

async function appendErrorLog(line: string): Promise<void> {
  try {
    await mkdir(dirname(ERROR_LOG_PATH), { recursive: true });
    await appendFile(ERROR_LOG_PATH, line + "\n", "utf8");
  } catch {
    // non-fatal
  }
}

// ── Error capture (fire-and-forget) ──────────────────────────────────────────
// Appends a JSONL entry to errors.jsonl. Never throws; never blocks the caller.

export function captureError(
  err: IxError,
  context: string,
): void {
  void (async () => {
    try {
      const ts = new Date().toISOString();
      const entry = JSON.stringify({
        ts,
        code: err.code,
        message: redact(err.message.slice(0, 300)),
        context: redact(context.slice(0, 200)),
        cause: redact(String(err.cause ?? "").slice(0, 300)),
      });
      await appendErrorLog(entry);
    } catch {
      // truly fire-and-forget
    }
  })();
}
