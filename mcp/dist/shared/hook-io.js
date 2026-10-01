// Copyright 2026 Ix Infrastructure Inc.
// Cursor hook I/O: the input fields the hooks read and the output fields Cursor
// actually consumes, per event. Source: https://cursor.com/docs/hooks
// ("Reference" -> "Common schema" and "Hook events").
//
// Only two outputs put text in front of the model without blocking anything:
//   sessionStart -> additional_context  ("added to the conversation's initial
//                                        system context")
//   postToolUse  -> additional_context  ("injected into the conversation after
//                                        the tool result")
// preToolUse's agent_message is fed back only when the action is denied, and
// beforeSubmitPrompt accepts only continue/user_message, so neither carries
// advisory context. stop accepts only followup_message, which submits a new user
// message and starts another agent turn.
import { isAbsolute } from "node:path";
import { gitRoot, projectDirs, rootContaining } from "./auto-map.js";
export async function readHookInput() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        return null;
    }
}
export function writeHookOutput(output) {
    process.stdout.write(JSON.stringify(output));
}
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
export async function ixRoot(input, filePath) {
    const dirs = projectDirs(input.workspace_roots);
    let dir;
    if (filePath !== undefined) {
        dir = rootContaining(filePath, dirs);
    }
    else if (typeof input.cwd === "string" &&
        isAbsolute(input.cwd) &&
        (dirs.includes(input.cwd) || rootContaining(input.cwd, dirs) !== undefined)) {
        dir = input.cwd;
    }
    else {
        dir = dirs[0];
    }
    if (!dir)
        return null;
    return (await gitRoot(dir)) ?? dir;
}
//# sourceMappingURL=hook-io.js.map