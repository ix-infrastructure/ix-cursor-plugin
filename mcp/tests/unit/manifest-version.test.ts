// Copyright 2026 Ix Infrastructure Inc.

// The plugin's version is written in more than one file: the manifest Cursor
// reads (.cursor-plugin/plugin.json) and the package that builds the hooks
// (mcp/package.json, mirrored at the root of mcp/package-lock.json). The
// installer reports the manifest's version as the one it installed, so a
// release that bumps one file and not the others would install under a version
// that does not say what the code is. `npm test` runs in CI, which makes a
// disagreement a red build.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PLUGIN_ROOT } from "../helpers/cursor-hooks.js";

function versionIn(relPath: string): unknown {
  const parsed = JSON.parse(readFileSync(join(PLUGIN_ROOT, relPath), "utf8")) as {
    version?: unknown;
  };
  return parsed.version;
}

test("plugin.json, mcp/package.json and its lockfile declare the same version", () => {
  const manifest = versionIn(".cursor-plugin/plugin.json");
  assert.equal(typeof manifest, "string", ".cursor-plugin/plugin.json has no version");
  assert.match(manifest as string, /^\d+\.\d+\.\d+/, "plugin.json version is not semver");

  assert.equal(
    versionIn("mcp/package.json"),
    manifest,
    "mcp/package.json and .cursor-plugin/plugin.json disagree on the version",
  );
  assert.equal(
    versionIn("mcp/package-lock.json"),
    manifest,
    "mcp/package-lock.json and .cursor-plugin/plugin.json disagree on the version",
  );
});
