// Copyright 2026 Ix Infrastructure Inc.
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
//# sourceMappingURL=errors.js.map