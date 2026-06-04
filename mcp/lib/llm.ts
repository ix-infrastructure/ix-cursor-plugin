// ── ix `--format llm` fast-path ────────────────────────────────────────────────
//
// A strictly-additive optimization. For read tools that map 1:1 to a single ix
// command and only re-project the response, we forward the CLI's token-optimized
// `--format llm` text straight to the model instead of parsing JSON and rebuilding
// a verbose envelope. This cuts response tokens ~2-3x on tree/table output.
//
// Safety invariants (every fall-through returns null so the caller runs its
// unchanged JSON path — behavior is then byte-identical to before this module):
//   - Gated to ix >= 0.7.0 (the release that introduced `--format llm`).
//   - Never PARSES llm output; only redacts secrets and forwards it.
//   - Any error, empty output, or unsupported CLI defers to the JSON path.
//   - `IX_DISABLE_LLM_FORMAT=1` forces the JSON path everywhere (kill switch).

import { runIx, runIxLlm } from "./cli.js";
import { TIMEOUT_DEFAULT_MS } from "./config.js";
import { type ToolResult, wrapText } from "./parser.js";
import { redactSecrets } from "../shared/secrets.js";

export const MIN_LLM_VERSION: SemVer = [0, 7, 0];

type SemVer = [number, number, number];

export function parseSemver(value: string): SemVer | null {
  const match = value.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function gte(a: SemVer, b: SemVer): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return true;
}

function llmDisabled(): boolean {
  const flag = process.env["IX_DISABLE_LLM_FORMAT"]?.toLowerCase();
  return flag === "1" || flag === "true";
}

async function detectIxVersion(): Promise<string> {
  // Generous timeout: `ix` runs a non-awaited update check that delays process
  // exit (observed ~7-8s on a cold cache), and execFile resolves on exit. A
  // tight timeout here would spuriously fail the probe and silently disable the
  // fast-path. This runs once per process (memoized), so the cost is paid at
  // most once; on timeout it fails closed to the JSON path.
  const result = await runIx(["--version"], { timeout: TIMEOUT_DEFAULT_MS });
  if (!result.ok) return "unknown";
  const trimmed = result.stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed["version"] === "string" && parsed["version"].trim()) {
      return parsed["version"].trim();
    }
  } catch {
    // ix may print a plain version string; fall through to token scan.
  }
  return trimmed.split(/\s+/)[0] ?? "unknown";
}

// Process-lifetime memo (a server queries the CLI version at most once). Not the
// shared disk cache: this keeps the gate deterministic and resettable in tests.
let supportPromise: Promise<boolean> | null = null;

export function resetLlmSupportCache(): void {
  supportPromise = null;
}

export async function ixSupportsLlm(): Promise<boolean> {
  if (llmDisabled()) return false;
  if (!supportPromise) {
    supportPromise = (async () => {
      const version = parseSemver(await detectIxVersion());
      return version !== null && gte(version, MIN_LLM_VERSION);
    })();
  }
  return supportPromise;
}

// Same secret scrubbing the JSON path applies per-field via sanitizeParsedValue,
// run once over the whole flat text. redactSecrets is idempotent and order-free,
// so a single pass over key=value lines is equivalent to the per-value walk.
export function redactLlmText(text: string): string {
  return redactSecrets(text);
}

// ix emits errors as a verbatim `error code=<slug> message="..."` line on stdout
// AND exits 0 (verified live: unresolved_target, ambiguous_target). Without this
// check tryLlm would forward that error line as a successful text result.
// Detecting it lets tryLlm defer to the JSON path, so error handling stays
// byte-identical to the non-llm path (a structured {ok:false} envelope). No
// success record for the migrated read commands begins with `error code=`, so
// this never swallows real data.
export function isLlmErrorLine(text: string): boolean {
  return /^error code=/.test(text.trimStart());
}

// Attempt the llm fast-path for a single-command read tool. Returns a verbatim
// text result on success, or null to signal "use the JSON fallback".
export async function tryLlm(
  toolName: string,
  args: string[],
  input: Record<string, unknown>,
  opts: { timeout?: number } = {},
): Promise<ToolResult | null> {
  if (!(await ixSupportsLlm())) return null;

  let result;
  try {
    result = await runIxLlm(args, opts);
  } catch {
    return null;
  }

  // A failed invocation (unknown-format on an unexpected CLI, or a real command
  // error like "no such symbol") defers to the JSON path, which formats errors
  // precisely and identically to today.
  if (!result.ok) return null;

  const text = redactLlmText(result.stdout).trim();
  if (!text) return null;

  // ix signals errors via an `error code=` line on stdout with exit 0; defer
  // those to the JSON path so the error contract is unchanged.
  if (isLlmErrorLine(text)) return null;

  return wrapText(toolName, input, text, result.durationMs);
}
