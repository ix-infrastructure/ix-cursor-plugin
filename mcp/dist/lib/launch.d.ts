export interface LaunchEnv {
    /** Defaults to process.platform. */
    platform?: NodeJS.Platform;
    /** Defaults to process.env. */
    env?: NodeJS.ProcessEnv;
}
export interface IxLaunch {
    file: string;
    args: string[];
    /** True only for the cmd.exe wrapper, whose line is already escaped. */
    windowsVerbatimArguments: boolean;
}
/**
 * The file a shell would run for `bin`, or null. A name containing a path
 * separator is checked as given; a bare name is searched on PATH (on Windows
 * with each PATHEXT extension, unless it already has one of them). Replaces
 * `command -v`, which only exists in a POSIX shell.
 */
export declare function findExecutable(bin: string, opts?: LaunchEnv): Promise<string | null>;
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
export declare function quoteCmdArg(arg: string): string;
/** How to start `bin args...` on this platform. Throws only for an argument cmd cannot carry. */
export declare function ixLaunch(bin: string, args: string[], opts?: LaunchEnv): Promise<IxLaunch>;
//# sourceMappingURL=launch.d.ts.map