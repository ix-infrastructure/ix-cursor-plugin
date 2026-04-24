import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { type ToolResult } from "../lib/parser.js";
type ToolSchema = ZodRawShapeCompat;
export type ToolInput<TSchema extends ToolSchema> = ShapeOutput<TSchema>;
interface ToolDefinition<TSchema extends ToolSchema> {
    name: string;
    description: string;
    schema: TSchema;
    handler: (input: ToolInput<TSchema>) => Promise<ToolResult>;
}
export declare function registerIxTool<TSchema extends ToolSchema>(server: McpServer, definition: ToolDefinition<TSchema>): void;
export {};
//# sourceMappingURL=base.d.ts.map