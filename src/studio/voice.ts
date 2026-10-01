// Voice guardrails for the Writers Studio — the rules from
// docs/WRITER_HANDOFF.md ("Writing guardrails"), as live, SOFT lint. Nothing
// here blocks a save or a publish: a flag is a nudge, and the writer is
// allowed to overrule it (a rule she has to fight teaches her to ignore the
// panel — same calibration lesson as the strip-sizing advice).
//
// Pure functions, no DOM, so the rules are unit-testable and the same
// checks can run anywhere a line is shown.

export type LintLevel = "ok" | "warn" | "bad";
export interface LintFlag { level: LintLevel; text: string }

export type LineKind = "banner" | "dialog" | "note" | "hint" | "blurb";

/** The iceberg rule: these words never appear in-game. Matched as whole
 *  words, case-insensitively, so "programmed" and "servers" are caught but
 *  "decode" and "iterate" (not in the list) are not. */
export const ICEBERG_WORDS = [
  "ai", "simulation", "simulated", "simulate", "program", "programmed", "programming",
  "code", "coded", "construct", "constructs", "iteration", "iterations", "algorithm",
  "algorithms", "data", "server", "servers", "pal",
];

/** Banner geometry, mirrored from drawTauntBanner: 10px monospace (~6px per
 *  glyph), width min(view-40, max(240, text+78)), text column width-58,
 *  two 11px lines fit in the 44px card. A third line spills. */
export function bannerLines(text: string, viewW = 640): number {
  const glyph = 6;
  const w = Math.min(viewW - 40, Math.max(240, text.length * glyph + 78));
  const cols = Math.max(1, Math.floor((w - 58) / glyph));
  // Greedy word wrap, same as wrapText.
  let lines = 1, col = 0;
  for (const word of text.split(" ")) {
    const len = word.length + (col > 0 ? 1 : 0);
    if (col > 0 && col + len > cols) { lines++; col = word.length; }
    else col += len;
  }
  return lines;
}

/** The safe banner budget from the handoff ("under ~140 characters"). */
export const BANNER_SOFT_MAX = 140;

export function icebergHits(text: string): string[] {
  const hits: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (ICEBERG_WORDS.includes(w) && !hits.includes(w)) hits.push(w);
  }
  return hits;
}

/** "Subject #NN" numbers stay below 67 — the one #67 is the Exit Wing's. */
export function subjectNumberIssues(text: string, roomId?: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/Subject\s*#\s*(\d+)/gi)) {
    const n = Number(m[1]);
    if (n > 67) out.push(`Subject #${n} — numbers only go up to #67 (that's the player)`);
    else if (n === 67 && roomId !== "exit_wing") out.push("Subject #67 is the player — only the Exit Wing note may be signed with it");
  }
  return out;
}

export function lintLine(text: string, kind: LineKind, ctx: { roomId?: string; required?: boolean } = {}): LintFlag[] {
  const flags: LintFlag[] = [];
  const t = text.trim();
  if (!t) {
    if (ctx.required) flags.push({ level: "bad", text: "empty — this will show as nothing" });
    return flags;
  }
  for (const w of icebergHits(t)) flags.push({ level: "bad", text: `“${w}” — iceberg word, never said in-game` });
  if (kind === "banner") {
    const lines = bannerLines(t);
    if (lines > 2) flags.push({ level: "bad", text: `won't fit the banner (~${lines} lines) — it shows two` });
    else if (t.length > BANNER_SOFT_MAX) flags.push({ level: "warn", text: `${t.length} chars — long for a banner, shorter lands harder` });
    else flags.push({ level: "ok", text: `${t.length} chars · ${lines} line${lines === 1 ? "" : "s"}` });
  }
  if (kind === "note" || kind === "dialog") {
    for (const issue of subjectNumberIssues(t, ctx.roomId)) flags.push({ level: "warn", text: issue });
  }
  if (kind === "hint" && t.length > 60) flags.push({ level: "warn", text: `${t.length} chars — hints read best short` });
  if (kind === "blurb" && t.length > 120) flags.push({ level: "warn", text: `${t.length} chars — one-liner territory` });
  return flags;
}

/** Highest severity in a set of flags, for a card-level badge. */
export function worstLevel(flags: LintFlag[]): LintLevel {
  if (flags.some((f) => f.level === "bad")) return "bad";
  if (flags.some((f) => f.level === "warn")) return "warn";
  return "ok";
}
