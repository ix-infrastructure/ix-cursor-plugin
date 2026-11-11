// Copyright 2026 Ix Infrastructure Inc.
// How the plugin finds and starts `ix`, on every platform.
//
// POSIX: unchanged. execFile/spawn get the bare name and search PATH
// themselves; findExecutable only answers "is it there" for checkHealth.
//
// Windows: the Ix installer puts `<home>\bin\ix.cmd` on PATH, which runs
// `<home>\cli\ix.cmd`, which runs `node "<main.js>" %*`. Node will not start a
// .cmd without a shell, and libuv's own PATH search only tries .com and .exe,
// so `execFile("ix")` fails there. `ix` is looked up on PATH with PATHEXT, then:
//
//   - an .exe starts directly;
//   - the installer layout above starts node with the CLI script and the
//     arguments as an argv array, with no shell at all (installerLaunch);
//   - any other .cmd/.bat starts through cmd.exe with every argument quoted so
//     that it stays data however many batch files pass it on (quoteCmdArg).
//
// Arguments include search patterns and paths from the agent's tool calls,
// so none is ever pasted into a command line raw.
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, posix, win32 } from "node:path";
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
/** Windows environment names are case-insensitive; a copied env object is not. */
function envVar(env, name, win) {
    if (!win)
        return env[name];
    const key = Object.keys(env).find((k) => k.toUpperCase() === name);
    return key === undefined ? undefined : env[key];
}
async function isExecutableFile(path, win) {
    try {
        if (!(await stat(path)).isFile())
            return false;
        if (!win)
            await access(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function isFile(path) {
    try {
        return (await stat(path)).isFile();
    }
    catch {
        return false;
    }
}
// PATH search hits, per process. Keyed on everything the search reads, so a
// changed PATH is searched again. A miss is not cached (ix installed while the
// MCP server runs must still be found), nor is an explicit path (one stat).
const lookupCache = new Map();
/**
 * The file a shell would run for `bin`, or null. A name containing a path
 * separator is checked as given; a bare name is searched on PATH (on Windows
 * with each PATHEXT extension, unless it already has one of them). Empty and
 * relative PATH entries are skipped, so nothing is ever picked up from the
 * working directory. Replaces `command -v`, which only exists in a POSIX shell.
 */
export async function findExecutable(bin, opts = {}) {
    const win = (opts.platform ?? process.platform) === "win32";
    const env = opts.env ?? process.env;
    if (!bin)
        return null;
    const pathVar = envVar(env, "PATH", win) ?? "";
    const pathExt = envVar(env, "PATHEXT", win) || DEFAULT_PATHEXT;
    const key = JSON.stringify([bin, win, pathVar, win ? pathExt : ""]);
    const cached = lookupCache.get(key);
    if (cached !== undefined)
        return cached;
    let names = [bin];
    if (win) {
        const exts = pathExt
            .split(";")
            .map((e) => e.trim())
            .filter(Boolean);
        const own = extname(bin).toUpperCase();
        names = own && exts.some((e) => e.toUpperCase() === own) ? [bin] : exts.map((e) => bin + e.toLowerCase());
    }
    const hasSeparator = win ? /[\\/]/.test(bin) : bin.includes("/");
    const isAbs = win ? win32.isAbsolute : posix.isAbsolute;
    const dirs = hasSeparator
        ? [""]
        : pathVar
            .split(win ? ";" : ":")
            .map((d) => (win ? d.trim().replace(/^"(.*)"$/, "$1") : d))
            .filter((d) => d && isAbs(d));
    for (const dir of dirs) {
        for (const name of names) {
            const candidate = dir ? join(dir, name) : name;
            if (await isExecutableFile(candidate, win)) {
                if (!hasSeparator)
                    lookupCache.set(key, candidate);
                return candidate;
            }
        }
    }
    return null;
}
// ── Installer layout: node + script, no shell ────────────────────────────────
// `node "<script>" %*` (optionally `@`-prefixed, node optionally quoted or a
// full path), the line the Ix release writes into cli\ix.cmd.
const NODE_LINE = /^\s*@?\s*(?:"([^"]+)"|([^\s"]+))\s+"([^"]+)"\s+%\*\s*$/;
/** The node binary the inner launcher names, resolved to an absolute path. */
async function resolveNode(named, opts) {
    if (!/^node(\.exe)?$/i.test(basename(named)))
        return null;
    if (win32.isAbsolute(named))
        return (await isFile(named)) ? named : null;
    if (named !== basename(named))
        return null;
    // The same `node` the .cmd would have run: the first node.exe on PATH.
    const onPath = await findExecutable("node.exe", opts);
    if (onPath)
        return onPath;
    // Else the Node this plugin runs on, if it is plain node (not an editor's runtime).
    return /^node(\.exe)?$/i.test(basename(process.execPath)) ? process.execPath : null;
}
/** The CLI script cli\ix.cmd's node line runs, or null when the line is not the known shape. */
function scriptFromLine(line, cliDir) {
    const m = NODE_LINE.exec(line);
    if (!m)
        return null;
    const node = (m[1] ?? m[2]);
    let script = m[3];
    if (/^%~dp0/i.test(script))
        script = join(cliDir, script.slice(5));
    // Anything else cmd would expand is not a plain path; do not guess.
    if (script.includes("%") || node.includes("%"))
        return null;
    if (!win32.isAbsolute(script))
        return null;
    return { node, script };
}
/**
 * When `resolved` is the installer's `<home>\bin\ix.cmd`, the node binary and
 * CLI script it ends up running, so `ix` can start with no cmd.exe at all.
 * Null for any other layout.
 */
export async function installerLaunch(resolved, opts = {}) {
    if (basename(resolved).toLowerCase() !== "ix.cmd")
        return null;
    const binDir = dirname(resolved);
    if (basename(binDir).toLowerCase() !== "bin")
        return null;
    const cliDir = join(dirname(binDir), "cli");
    const inner = join(cliDir, "ix.cmd");
    let text;
    try {
        if ((await stat(inner)).size > 64 * 1024)
            return null;
        text = await readFile(inner, "utf8");
    }
    catch {
        return null;
    }
    let found = text
        .split(/\r?\n/)
        .map((l) => scriptFromLine(l, cliDir))
        .find((x) => x !== null) ?? null;
    if (!found || !(await isFile(found.script))) {
        // The path the Ix release puts the CLI entry at.
        const known = join(cliDir, "dist", "cli", "main.js");
        found = (await isFile(known)) ? { node: found?.node ?? "node", script: known } : null;
    }
    if (!found)
        return null;
    const node = await resolveNode(found.node, opts);
    return node ? { node, script: found.script } : null;
}
// ── Any other .cmd/.bat: cmd.exe with depth-proof quoting ────────────────────
/**
 * One argument for a cmd.exe line that runs a batch file, quoted so it stays
 * one literal argument however many batch files re-expand it with %*.
 *
 * The scheme Rust's standard library uses for batch files: the argument is
 * always in double quotes, an inner `"` is written `""` (so cmd's quote state
 * never leaves the argument), backslashes before a quote or the end are
 * doubled for the program's own argv parser, and `%` is written `%%cd:~,%`,
 * which cmd's /c line expands back to a single `%` without expanding any
 * variable name after it. No carets: inside quotes cmd keeps them as data.
 * A line break cannot be carried through cmd at all, so it is refused.
 */
export function quoteCmdArg(arg) {
    if (/[\r\n]/.test(arg)) {
        throw new Error("an argument with a line break cannot be passed through cmd.exe");
    }
    let out = '"';
    let backslashes = 0;
    for (const ch of arg) {
        if (ch === "\\") {
            backslashes++;
            out += ch;
            continue;
        }
        if (ch === '"')
            out += "\\".repeat(backslashes) + '"';
        else if (ch === "%")
            out += "%%cd:~,";
        backslashes = 0;
        out += ch;
    }
    return out + "\\".repeat(backslashes) + '"';
}
/**
 * `cmd.exe` starting the batch file `script` with `args`. /v:off so delayed
 * expansion (which a registry setting can turn on) never touches `!`;
 * /e:on for the `%cd:~,%` substring; /d to skip AutoRun; /s so cmd strips
 * exactly the outer quotes added here.
 */
export function batchLaunch(script, args, opts = {}) {
    const win = (opts.platform ?? process.platform) === "win32";
    const env = opts.env ?? process.env;
    if (script.includes('"') || /[\r\n]/.test(script)) {
        throw new Error("the ix launcher path cannot be passed through cmd.exe");
    }
    const line = [`"${script.replace(/%/g, "%%cd:~,%")}"`, ...args.map(quoteCmdArg)].join(" ");
    return {
        file: envVar(env, "COMSPEC", win) || "cmd.exe",
        args: ["/e:on", "/d", "/v:off", "/s", "/c", `"${line}"`],
        windowsVerbatimArguments: true,
    };
}
// The installer layout found per launcher (and PATH, which picks node), per process.
const installerCache = new Map();
/**
 * How to start `bin args...` on this platform. Throws only when the cmd.exe
 * route is needed and an argument (a line break) cannot be carried through it.
 */
export async function ixLaunch(bin, args, opts = {}) {
    const win = (opts.platform ?? process.platform) === "win32";
    if (!win)
        return { file: bin, args, windowsVerbatimArguments: false };
    const resolved = (await findExecutable(bin, opts)) ?? bin;
    if (!/\.(cmd|bat)$/i.test(resolved)) {
        return { file: resolved, args, windowsVerbatimArguments: false };
    }
    const key = JSON.stringify([resolved, envVar(opts.env ?? process.env, "PATH", win) ?? ""]);
    let direct = installerCache.get(key) ?? null;
    if (!direct) {
        direct = await installerLaunch(resolved, opts);
        // Only a found layout is remembered; a miss is checked again next time.
        if (direct)
            installerCache.set(key, direct);
    }
    if (direct) {
        return { file: direct.node, args: [direct.script, ...args], windowsVerbatimArguments: false };
    }
    return batchLaunch(resolved, args, opts);
}
