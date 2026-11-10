// Copyright 2026 Ix Infrastructure Inc.
// How the plugin finds and starts `ix`, on every platform.
//
// POSIX: unchanged. execFile/spawn get the bare name and search PATH
// themselves; findExecutable only answers "is it there" for checkHealth.
//
// Windows: the Ix installer puts `ix.cmd` on PATH. Node will not start a .cmd
// without a shell, and libuv's own PATH search only tries .com and .exe, so
// `execFile("ix")` fails there. Instead the binary is looked up on PATH with
// PATHEXT; an .exe starts directly, and a .cmd/.bat starts as
// `cmd.exe /d /s /c "<line>"` where every argument is escaped by quoteCmdArg.
// A search pattern is never pasted into a command line raw.
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { extname, join } from "node:path";
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
/**
 * The file a shell would run for `bin`, or null. A name containing a path
 * separator is checked as given; a bare name is searched on PATH (on Windows
 * with each PATHEXT extension, unless it already has one of them). Replaces
 * `command -v`, which only exists in a POSIX shell.
 */
export async function findExecutable(bin, opts = {}) {
    const win = (opts.platform ?? process.platform) === "win32";
    const env = opts.env ?? process.env;
    if (!bin)
        return null;
    let names = [bin];
    if (win) {
        const exts = (envVar(env, "PATHEXT", win) || DEFAULT_PATHEXT)
            .split(";")
            .map((e) => e.trim())
            .filter(Boolean);
        const own = extname(bin).toUpperCase();
        names = own && exts.some((e) => e.toUpperCase() === own) ? [bin] : exts.map((e) => bin + e.toLowerCase());
    }
    const hasSeparator = win ? /[\\/]/.test(bin) : bin.includes("/");
    const dirs = hasSeparator
        ? [""]
        : (envVar(env, "PATH", win) ?? "")
            .split(win ? ";" : ":")
            .map((d) => (win ? d.trim().replace(/^"(.*)"$/, "$1") : d))
            .filter(Boolean);
    for (const dir of dirs) {
        for (const name of names) {
            const candidate = dir ? join(dir, name) : name;
            if (await isExecutableFile(candidate, win))
                return candidate;
        }
    }
    return null;
}
// cmd.exe metacharacters (the set cross-spawn escapes, after qntm.org/cmd).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
/**
 * One argument for the cmd.exe line that runs a .cmd launcher.
 *
 * First quoted for the program that finally parses it (MSVCRT rules:
 * backslashes before a quote or the end are doubled, quotes are escaped).
 * Then every cmd metacharacter is caret-escaped twice: once for the
 * `cmd /c` line and once for the line inside ix.cmd that expands %*.
 * Because even the quotes are escaped, cmd never enters quote mode, so `&`,
 * `|`, `"` and `%` all reach ix as data. A line break cannot be carried
 * through cmd at all, so it is refused.
 */
export function quoteCmdArg(arg) {
    if (/[\r\n]/.test(arg)) {
        throw new Error("an argument with a line break cannot be passed through cmd.exe");
    }
    const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
    return quoted.replace(CMD_META, "^^^$1");
}
/** How to start `bin args...` on this platform. Throws only for an argument cmd cannot carry. */
export async function ixLaunch(bin, args, opts = {}) {
    const win = (opts.platform ?? process.platform) === "win32";
    if (!win)
        return { file: bin, args, windowsVerbatimArguments: false };
    const env = opts.env ?? process.env;
    const resolved = (await findExecutable(bin, opts)) ?? bin;
    if (!/\.(cmd|bat)$/i.test(resolved)) {
        return { file: resolved, args, windowsVerbatimArguments: false };
    }
    const line = [`"${resolved}"`, ...args.map(quoteCmdArg)].join(" ");
    return {
        file: envVar(env, "COMSPEC", win) || "cmd.exe",
        args: ["/d", "/s", "/c", `"${line}"`],
        windowsVerbatimArguments: true,
    };
}
//# sourceMappingURL=launch.js.map