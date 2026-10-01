// Copyright 2026 Ix Infrastructure Inc.

// Cursor's hook contract as documented at https://cursor.com/docs/hooks
// ("Reference" -> "Hook events"), plus readers for this plugin's hooks.json.
// Tests check hook output against this table, not against what the hooks
// happen to print.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Output fields Cursor reads, per agent hook event. Empty: output is ignored. */
export const OUTPUT_FIELDS: Record<string, readonly string[]> = {
  // The schema also accepts continue/user_message here, but "current callers do
  // not enforce them".
  sessionStart: ["env", "additional_context"],
  sessionEnd: [],
  preToolUse: ["permission", "user_message", "agent_message", "updated_input"],
  postToolUse: ["updated_mcp_tool_output", "additional_context"],
  postToolUseFailure: ["additional_context"],
  subagentStart: ["permission", "user_message"],
  subagentStop: ["followup_message"],
  beforeShellExecution: ["permission", "user_message", "agent_message"],
  afterShellExecution: [],
  beforeMCPExecution: ["permission", "user_message", "agent_message"],
  afterMCPExecution: [],
  beforeReadFile: ["permission", "user_message"],
  afterFileEdit: [],
  beforeSubmitPrompt: ["continue", "user_message"],
  preCompact: ["user_message"],
  stop: ["followup_message"],
  afterAgentResponse: [],
  afterAgentThought: [],
};

/** Matcher values the docs list for the generic tool hooks. */
export const TOOL_MATCHERS = ["Shell", "Read", "Write", "Grep", "Delete", "Task"];

/**
 * The text a hook's output puts in front of the model for `event`, or "".
 * sessionStart/postToolUse(Failure): additional_context. preToolUse:
 * agent_message, "fed back to the agent when the action is denied".
 */
export function modelVisibleText(event: string, output: Record<string, unknown>): string {
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  switch (event) {
    case "sessionStart":
    case "postToolUse":
    case "postToolUseFailure":
      return text(output["additional_context"]);
    case "preToolUse":
      return output["permission"] === "deny" ? text(output["agent_message"]) : "";
    default:
      return "";
  }
}

/** Throws unless every key of `output` is one Cursor reads for `event`. */
export function assertOutputFields(event: string, output: Record<string, unknown>): void {
  const allowed = OUTPUT_FIELDS[event];
  if (!allowed) throw new Error(`not a documented agent hook event: ${event}`);
  const extra = Object.keys(output).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new Error(`${event} output has fields Cursor ignores: ${extra.join(", ")}`);
  }
}

export interface HookEntry {
  event: string;
  command: string;
  matcher?: string;
  timeout?: number;
}

export function hookEntries(): HookEntry[] {
  const config = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, "hooks/hooks.json"), "utf8")) as {
    hooks: Record<string, Array<Omit<HookEntry, "event">>>;
  };
  return Object.entries(config.hooks).flatMap(([event, entries]) =>
    entries.map((entry) => ({ event, ...entry })),
  );
}

const SCRIPT_RE = /mcp\/dist\/hooks\/([a-z-]+)\.js/;

/** The hooks/hooks.json registrations of mcp/hooks/<name>.ts. */
export function registrationsOf(name: string): HookEntry[] {
  return hookEntries().filter((entry) => SCRIPT_RE.exec(entry.command)?.[1] === name);
}

export function scriptName(command: string): string | undefined {
  return SCRIPT_RE.exec(command)?.[1];
}

/** Common input every agent hook receives ("Input (all hooks)"). */
export function commonInput(event: string, workspaceRoots: string[]): Record<string, unknown> {
  return {
    conversation_id: "conv-1",
    generation_id: "gen-1",
    model: "test-model",
    hook_event_name: event,
    cursor_version: "test",
    workspace_roots: workspaceRoots,
    user_email: null,
    transcript_path: null,
  };
}
