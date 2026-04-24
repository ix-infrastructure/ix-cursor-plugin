import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { redactSecrets } from "../shared/secrets.js";
export const ERROR_LOG_PATH = join(homedir(), ".local", "share", "ix", "cursor-plugin", "errors", "errors.jsonl");
export class IxError extends Error {
    code;
    cause;
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = "IxError";
    }
}
function redact(text) {
    const home = process.env["HOME"] ?? "__NO_HOME__";
    return redactSecrets(text).replaceAll(new RegExp(home, "g"), "~");
}
async function appendErrorLog(line) {
    try {
        await mkdir(dirname(ERROR_LOG_PATH), { recursive: true });
        await appendFile(ERROR_LOG_PATH, line + "\n", "utf8");
    }
    catch {
        // non-fatal
    }
}
// ── Error capture (fire-and-forget) ──────────────────────────────────────────
// Appends a JSONL entry to errors.jsonl. Never throws; never blocks the caller.
export function captureError(err, context) {
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
        }
        catch {
            // truly fire-and-forget
        }
    })();
}
//# sourceMappingURL=errors.js.map