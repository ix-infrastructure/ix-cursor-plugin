export declare const PLUGIN_ROOT: string;
/** Output fields Cursor reads, per agent hook event. Empty: output is ignored. */
export declare const OUTPUT_FIELDS: Record<string, readonly string[]>;
/** Matcher values the docs list for the generic tool hooks. */
export declare const TOOL_MATCHERS: string[];
/**
 * The text a hook's output puts in front of the model for `event`, or "".
 * sessionStart/postToolUse(Failure): additional_context. preToolUse:
 * agent_message, "fed back to the agent when the action is denied".
 */
export declare function modelVisibleText(event: string, output: Record<string, unknown>): string;
/** Throws unless every key of `output` is one Cursor reads for `event`. */
export declare function assertOutputFields(event: string, output: Record<string, unknown>): void;
export interface HookEntry {
    event: string;
    command: string;
    matcher?: string;
    timeout?: number;
}
export declare function hookEntries(): HookEntry[];
/** The hooks/hooks.json registrations of mcp/hooks/<name>.ts. */
export declare function registrationsOf(name: string): HookEntry[];
export declare function scriptName(command: string): string | undefined;
/** Common input every agent hook receives ("Input (all hooks)"). */
export declare function commonInput(event: string, workspaceRoots: string[]): Record<string, unknown>;
//# sourceMappingURL=cursor-hooks.d.ts.map