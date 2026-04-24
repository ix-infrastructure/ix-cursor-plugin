import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ShapeOutput,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";

import { captureError, IxError } from "../lib/errors.js";
import { ParseError, type ToolResult, wrapErr } from "../lib/parser.js";

type ToolSchema = ZodRawShapeCompat;

export type ToolInput<TSchema extends ToolSchema> = ShapeOutput<TSchema>;

interface ToolDefinition<TSchema extends ToolSchema> {
  name: string;
  description: string;
  schema: TSchema;
  handler: (input: ToolInput<TSchema>) => Promise<ToolResult>;
}

interface JsonTextResponse {
  content: [
    {
      type: "text";
      text: string;
    },
  ];
}

export function registerIxTool<TSchema extends ToolSchema>(
  server: McpServer,
  definition: ToolDefinition<TSchema>,
): void {
  const validator = z.object(definition.schema as z.ZodRawShape);
  const registerTool = (
    server.tool as unknown as (
      name: string,
      description: string,
      paramsSchema: ToolSchema,
      cb: (rawInput: unknown, extra: unknown) => Promise<JsonTextResponse>,
    ) => unknown
  ).bind(server);

  registerTool(
    definition.name,
    definition.description,
    definition.schema,
    async (rawInput, _extra) => {
      const parsed = validator.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return jsonTextResponse(
          wrapErr(
            definition.name,
            asToolInput(rawInput),
            {
              code: "VALIDATION",
              message: formatValidationError(parsed.error),
            },
          ),
        );
      }

      try {
        const result = await definition.handler(parsed.data as ToolInput<TSchema>);
        return jsonTextResponse(result);
      } catch (error) {
        const ixError = normalizeToolError(error);
        captureError(ixError, `${definition.name} ${JSON.stringify(parsed.data)}`);
        return jsonTextResponse(
          wrapErr(definition.name, asToolInput(parsed.data), {
            code: ixError.code,
            message: ixError.message,
          }),
        );
      }
    },
  );
}

function jsonTextResponse(result: ToolResult): JsonTextResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result),
      },
    ],
  };
}

function normalizeToolError(error: unknown): IxError {
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

function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "input";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function asToolInput(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorWithCode = error as Error & { code?: string };
  return errorWithCode.code === "ENOENT";
}
