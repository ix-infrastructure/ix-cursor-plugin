// Copyright 2026 Ix Infrastructure Inc.

// What the Grep (pre-search) and shell-search hooks add after a symbol-like
// search: `ix locate`, then — only when that resolves one confident
// definition — `ix callers` for it. Anything else (ambiguous, not found, not
// mapped, low confidence, unparseable) is no context at all.

import { runIx, type IxResult } from "../lib/cli.js";
import { parseIxJson } from "../lib/parser.js";
import { classifyIntent, looksLikeSecret } from "./intent-classifier.js";
import { confidentDefinition, summarizeDefinition } from "./summarizers.js";

// Both ix calls share this budget; the hooks' Cursor timeout is 10 s.
const BUDGET_MS = 9_000;
// Not worth starting `ix callers` with less than this left.
const MIN_CALLERS_MS = 1_000;

function isRegexPattern(pattern: string): boolean {
  return /[*+?]|[[\]()]|\\[a-zA-Z]|\{[0-9]/.test(pattern);
}

/** True when `pattern` reads as a symbol name worth asking the graph about. */
export function isSymbolSearch(pattern: string): boolean {
  if (pattern.length < 3) return false;
  // Never log or forward credentials.
  if (looksLikeSecret(pattern)) return false;
  // A regex is not a name `ix locate` can resolve.
  if (isRegexPattern(pattern)) return false;
  return classifyIntent(pattern).intent === "symbol";
}

function parsed(result: IxResult): unknown {
  // ix prints its record on stdout even when it exits non-zero; the record,
  // not the exit code, says whether there is an answer.
  if (!result.stdout) return null;
  try {
    return parseIxJson(result.stdout);
  } catch {
    return null;
  }
}

export interface SearchContext {
  /** The line for the model. */
  text: string;
  /** The parsed ix records, for IX_HOOK_VERBOSITY=verbose. */
  raw: { locate: unknown; callers: unknown };
}

export async function searchContext(pattern: string, root: string): Promise<SearchContext | null> {
  const started = Date.now();
  const locate = parsed(await runIx(["locate", pattern], { timeout: BUDGET_MS, cwd: root }));
  const definition = confidentDefinition(locate);
  if (!definition) return null;

  const remaining = BUDGET_MS - (Date.now() - started);
  const callers =
    remaining >= MIN_CALLERS_MS
      ? parsed(await runIx(["callers", definition.name], { timeout: remaining, cwd: root }))
      : null;
  return { text: summarizeDefinition(pattern, definition, callers), raw: { locate, callers } };
}
