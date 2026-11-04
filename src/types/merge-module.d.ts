// Declarations for functions/api/_merge.js so src/editor can import it
// type-safely. Lives here (not next to the .js) because wrangler's Pages
// Functions build compiles every file under functions/ and chokes on a .d.ts.
declare module "*functions/api/_merge.js" {
  export type FileMap = Record<string, unknown>;

  export interface DiffEntry {
    id: string;
    kind: "added" | "removed" | "changed";
    fields?: string[];
  }

  export interface DiffChange {
    file: string;
    kind: "added" | "removed" | "changed";
    entries?: DiffEntry[];
    paths?: string[];
  }

  export const ID_ARRAY_FILES: Set<string>;
  export const DEEP_OBJECT_FILES: Set<string>;
  export function deepEqual(a: unknown, b: unknown): boolean;
  export function mergeBundles(
    base: FileMap | null | undefined,
    live: FileMap | null | undefined,
    incoming: FileMap | null | undefined
  ): FileMap;
  export type Resolution = "mine" | "theirs";
  export type PathSeg = string | { key: string };
  export interface MergeConflict {
    group: string;
    label: string;
    file: string;
    path: PathSeg[];
    base: unknown;
    live: unknown;
    incoming: unknown;
    resolved: Resolution | null;
  }
  export interface ConflictGroup {
    group: string;
    label: string;
    file: string;
    resolved: Resolution | null;
    values: { path: string[]; base: unknown; live: unknown; incoming: unknown }[];
  }
  export function mergeBundlesDetailed(
    base: FileMap | null | undefined,
    live: FileMap | null | undefined,
    incoming: FileMap | null | undefined,
    resolutions?: Record<string, Resolution>
  ): { files: FileMap; conflicts: MergeConflict[] };
  export function groupConflicts(conflicts: MergeConflict[]): ConflictGroup[];
  export function diffBundles(
    from: FileMap | null | undefined,
    to: FileMap | null | undefined
  ): DiffChange[];
  export function summarizeDiff(changes: DiffChange[], maxLines?: number): string[];
}
