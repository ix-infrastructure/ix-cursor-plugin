export declare const ERROR_LOG_PATH: string;
export type ErrorCode = "IX_NOT_FOUND" | "TIMEOUT" | "PARSE_FAILURE" | "VALIDATION" | "PERMISSION_DENIED" | "UNKNOWN";
export declare class IxError extends Error {
    readonly code: ErrorCode;
    readonly cause?: unknown | undefined;
    constructor(code: ErrorCode, message: string, cause?: unknown | undefined);
}
export declare function captureError(err: IxError, context: string): void;
//# sourceMappingURL=errors.d.ts.map