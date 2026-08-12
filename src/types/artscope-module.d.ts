// Declarations for functions/api/_artscope.js (same pattern/reason as
// merge-module.d.ts — wrangler chokes on .d.ts files under functions/).
declare module "*functions/api/_artscope.js" {
  export type FileMap = Record<string, unknown>;
  export const SPRITE_FIELDS: string[];
  export function overlayArtBundle(liveFiles: FileMap, artistFiles: FileMap): FileMap;
}
