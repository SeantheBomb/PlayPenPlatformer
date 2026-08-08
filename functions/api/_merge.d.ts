// Hand-written declarations for _merge.js so src/editor can import it
// type-safely (the module itself stays plain JS — it's shared with the
// Cloudflare Function and the node tools).

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
export function diffBundles(
  from: FileMap | null | undefined,
  to: FileMap | null | undefined
): DiffChange[];
export function summarizeDiff(changes: DiffChange[], maxLines?: number): string[];
