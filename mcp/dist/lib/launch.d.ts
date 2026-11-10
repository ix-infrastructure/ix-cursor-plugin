export interface LaunchEnv {
    /** Defaults to process.platform. */
    platform?: NodeJS.Platform;
    /** Defaults to process.env. */
    env?: NodeJS.ProcessEnv;
}
export interface IxLaunch {
    file: string;
    args: string[];
    /** True only for the cmd.exe wrapper, whose line is already quoted. */
    windowsVerbatimArguments: boolean;
}
/**
 * The file a shell would run for `bin`, or null. A name containing a path
 * separator is checked as given; a bare name is searched on PATH (on Windows
 * with each PATHEXT extension, unless it already has one of them). Empty and
 * relative PATH entries are skipped, so nothing is ever picked up from the
 * working directory. Replaces `command -v`, which only exists in a POSIX shell.
 */
export declare function findExecutable(bin: string, opts?: LaunchEnv): Promise<string | null>;
/**
 * When `resolved` is the installer's `<home>\bin\ix.cmd`, the node binary and
 * CLI script it ends up running, so `ix` can start with no cmd.exe at all.
 * Null for any other layout.
 */
export declare function installerLaunch(resolved: string, opts?: LaunchEnv): Promise<{
    node: string;
    script: string;
} | null>;
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
export declare function quoteCmdArg(arg: string): string;
/**
 * `cmd.exe` starting the batch file `script` with `args`. /v:off so delayed
 * expansion (which a registry setting can turn on) never touches `!`;
 * /e:on for the `%cd:~,%` substring; /d to skip AutoRun; /s so cmd strips
 * exactly the outer quotes added here.
 */
export declare function batchLaunch(script: string, args: string[], opts?: LaunchEnv): IxLaunch;
/**
 * How to start `bin args...` on this platform. Throws only when the cmd.exe
 * route is needed and an argument (a line break) cannot be carried through it.
 */
export declare function ixLaunch(bin: string, args: string[], opts?: LaunchEnv): Promise<IxLaunch>;
//# sourceMappingURL=launch.d.ts.map