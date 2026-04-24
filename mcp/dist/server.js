import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { register as registerBriefingTool } from "./tools/briefing.js";
import { register as registerCalleesTool } from "./tools/callees.js";
import { register as registerCallersTool } from "./tools/callers.js";
import { register as registerDecisionsTool } from "./tools/decisions.js";
import { register as registerDependsTool } from "./tools/depends.js";
import { register as registerExplainTool } from "./tools/explain.js";
import { register as registerHealthTool } from "./tools/health.js";
import { register as registerImpactTool } from "./tools/impact.js";
import { register as registerInventoryTool } from "./tools/inventory.js";
import { register as registerLocateTool } from "./tools/locate.js";
import { register as registerMapTool } from "./tools/map.js";
import { register as registerRankTool } from "./tools/rank.js";
import { register as registerSmellsTool } from "./tools/smells.js";
import { register as registerStatsTool } from "./tools/stats.js";
import { register as registerSubsystemsTool } from "./tools/subsystems.js";
import { register as registerTextTool } from "./tools/text.js";
import { register as registerTraceTool } from "./tools/trace.js";
const server = new McpServer({
    name: "ix-memory",
    version: "0.1.0",
});
registerBriefingTool(server);
registerCalleesTool(server);
registerCallersTool(server);
registerDecisionsTool(server);
registerDependsTool(server);
registerExplainTool(server);
registerHealthTool(server);
registerImpactTool(server);
registerInventoryTool(server);
registerLocateTool(server);
registerMapTool(server);
registerRankTool(server);
registerSmellsTool(server);
registerStatsTool(server);
registerSubsystemsTool(server);
registerTextTool(server);
registerTraceTool(server);
const transport = new StdioServerTransport();
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
await server.connect(transport);
//# sourceMappingURL=server.js.map