// Copyright 2026 Ix Infrastructure Inc.

import { stripHeader } from "./cli.js";
import { containsSecret, redactSecrets } from "../shared/secrets.js";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// ── JSON parser ───────────────────────────────────────────────────────────────
// Strips ix header noise, then parses JSON. Throws ParseError on failure.

function sanitizeParsedValue(value: unknown): unknown {
  if (typeof value === "string") {
    return containsSecret(value) ? redactSecrets(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeParsedValue(entry));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([key, entry]) => [key, sanitizeParsedValue(entry)]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function parseIxJson(raw: string): unknown {
  const cleaned = stripHeader(raw).trim();
  if (!cleaned) {
    throw new ParseError("ix produced no JSON output");
  }
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return sanitizeParsedValue(parsed);
  } catch (cause) {
    throw new ParseError(
      `ix output is not valid JSON: ${cleaned.slice(0, 120)}`,
    );
  }
}
