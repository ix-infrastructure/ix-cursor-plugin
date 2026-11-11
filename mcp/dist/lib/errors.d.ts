export type ErrorCode = "PERMISSION_DENIED";
export declare class IxError extends Error {
    readonly code: ErrorCode;
    readonly cause?: unknown | undefined;
    constructor(code: ErrorCode, message: string, cause?: unknown | undefined);
}
//# sourceMappingURL=errors.d.ts.map