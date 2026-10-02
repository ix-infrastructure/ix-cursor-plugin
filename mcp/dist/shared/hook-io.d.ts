/** Fields every agent hook receives (docs: "Input (all hooks)"). */
export interface CommonHookInput {
    hook_event_name?: string;
    conversation_id?: string;
    generation_id?: string;
    workspace_roots?: string[];
}
/** preToolUse / postToolUse input (docs: "preToolUse", "postToolUse"). */
export interface ToolHookInput<TInput = Record<string, unknown>> extends CommonHookInput {
    tool_name?: string;
    tool_input?: TInput;
    tool_output?: string;
    tool_use_id?: string;
    cwd?: string;
}
/** sessionStart output (docs: "sessionStart"). */
export interface SessionStartOutput {
    env?: Record<string, string>;
    additional_context?: string;
}
/** postToolUse output (docs: "postToolUse"). */
export interface PostToolUseOutput {
    additional_context?: string;
}
/** preToolUse output (docs: "preToolUse"). agent_message reaches the agent only on deny. */
export interface PreToolUseOutput {
    permission: "allow" | "deny";
    user_message?: string;
    agent_message?: string;
}
export declare function readHookInput<T>(): Promise<T | null>;
export declare function writeHookOutput(output: SessionStartOutput | PostToolUseOutput | PreToolUseOutput): void;
/**
 * The repo ix should run in for a hook event. The hook process cwd is not a
 * project root: the docs give each hook source its own working directory and
 * name none for plugins, and Cursor's own plugins (cursor/plugins) address
 * their scripts through ${CURSOR_PLUGIN_ROOT} and the project through
 * CURSOR_PROJECT_DIR. So every ix call takes an explicit cwd from the payload.
 *
 * With `filePath`, the workspace root that contains it; a file outside every
 * workspace root yields null. Otherwise the event's `cwd` when it lies in a
 * workspace root, else the first workspace root. Resolved to its git top level
 * when there is one.
 */
export declare function ixRoot(input: {
    workspace_roots?: unknown;
    cwd?: unknown;
}, filePath?: string): Promise<string | null>;
//# sourceMappingURL=hook-io.d.ts.map