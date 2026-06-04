import { z } from "zod";
import { captureError, IxError } from "../lib/errors.js";
import { isTextResult, ParseError, wrapErr } from "../lib/parser.js";
export function registerIxTool(server, definition) {
    const validator = z.object(definition.schema);
    const registerTool = server.tool.bind(server);
    registerTool(definition.name, definition.description, definition.schema, async (rawInput, _extra) => {
        const parsed = validator.safeParse(rawInput ?? {});
        if (!parsed.success) {
            return jsonTextResponse(wrapErr(definition.name, asToolInput(rawInput), {
                code: "VALIDATION",
                message: formatValidationError(parsed.error),
            }));
        }
        try {
            const result = await definition.handler(parsed.data);
            return jsonTextResponse(result);
        }
        catch (error) {
            const ixError = normalizeToolError(error);
            captureError(ixError, `${definition.name} ${JSON.stringify(parsed.data)}`);
            return jsonTextResponse(wrapErr(definition.name, asToolInput(parsed.data), {
                code: ixError.code,
                message: ixError.message,
            }));
        }
    });
}
function jsonTextResponse(result) {
    // llm-format results are forwarded verbatim so the model reads the compact
    // text directly. Wrapping them in the JSON envelope would re-escape newlines
    // and erase the token savings, so they bypass JSON.stringify.
    const text = isTextResult(result) ? result.text : JSON.stringify(result);
    return {
        content: [
            {
                type: "text",
                text,
            },
        ],
    };
}
function normalizeToolError(error) {
    if (error instanceof IxError) {
        return error;
    }
    if (error instanceof ParseError) {
        return new IxError("PARSE_FAILURE", error.message, error);
    }
    if (error instanceof z.ZodError) {
        return new IxError("VALIDATION", formatValidationError(error), error);
    }
    if (isNotFoundError(error)) {
        return new IxError("IX_NOT_FOUND", "ix CLI not found. Install it and ensure it is on PATH.", error);
    }
    if (error instanceof Error) {
        return new IxError("UNKNOWN", error.message, error);
    }
    return new IxError("UNKNOWN", String(error), error);
}
function formatValidationError(error) {
    return error.issues
        .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "input";
        return `${path}: ${issue.message}`;
    })
        .join("; ");
}
function asToolInput(value) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}
function isNotFoundError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    const errorWithCode = error;
    return errorWithCode.code === "ENOENT";
}
//# sourceMappingURL=base.js.map