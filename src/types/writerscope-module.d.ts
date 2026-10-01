// Declarations for functions/api/_writerscope.js (same pattern/reason as
// artscope-module.d.ts — wrangler chokes on .d.ts files under functions/).
declare module "*functions/api/_writerscope.js" {
  export type FileMap = Record<string, unknown>;
  export const NPC_STORY_FIELDS: string[];
  export const NOTE_STORY_FIELDS: string[];
  export const HINT_STORY_FIELDS: string[];
  export const STORY_ARRAY_FILES: Record<string, string[]>;
  export function overlayStoryBundle(liveFiles: FileMap, writerFiles: FileMap): FileMap;
}
