// Copyright 2026 Ix Infrastructure Inc.

// The only error lib/cli.ts raises itself: IX_BIN names a binary other than ix.
export type ErrorCode = "PERMISSION_DENIED";

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
