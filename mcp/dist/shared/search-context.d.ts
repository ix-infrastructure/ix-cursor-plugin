/** True when `pattern` reads as a symbol name worth asking the graph about. */
export declare function isSymbolSearch(pattern: string): boolean;
export interface SearchContext {
    /** The line for the model. */
    text: string;
    /** The parsed ix records, for IX_HOOK_VERBOSITY=verbose. */
    raw: {
        locate: unknown;
        callers: unknown;
    };
}
export declare function searchContext(pattern: string, root: string): Promise<SearchContext | null>;
//# sourceMappingURL=search-context.d.ts.map