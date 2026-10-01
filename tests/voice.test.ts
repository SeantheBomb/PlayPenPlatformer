// The Writers Studio's voice guardrails (docs/WRITER_HANDOFF.md "Writing
// guardrails"), pinned so a rewrite of the lint can't quietly stop catching
// an iceberg word or start nagging about a line that fits. Soft lint: these
// produce flags, never blocks.
import { describe, expect, it } from "vitest";
import { bannerLines, icebergHits, lintLine, subjectNumberIssues, worstLevel } from "../src/studio/voice";

describe("iceberg words", () => {
  it("catches the banned words as whole words, any case", () => {
    expect(icebergHits("The AI runs a Simulation on the server.")).toEqual(["ai", "simulation", "server"]);
  });
  it("does not catch words that merely contain them", () => {
    expect(icebergHits("Decode the aisle, then iterate on the paint.")).toEqual([]);
  });
  it("PAL never appears, even as a name", () => {
    expect(icebergHits("Ask Pal about it.")).toEqual(["pal"]);
  });
});

describe("banner fit", () => {
  it("a short line is one banner line", () => {
    expect(bannerLines("Snack time is never.")).toBe(1);
  });
  it("the longest shipped welcome line still fits in two", () => {
    expect(bannerLines("Ah, you're awake. Orientation is self-guided. It's always been self-guided. Don't think about the 'always.'")).toBeLessThanOrEqual(2);
  });
  it("a paragraph spills to three", () => {
    const long = "Subject sixty-seven, please report to the front office for your mandatory orientation, which is self-guided, always has been, and will continue to be until further notice or forever.";
    expect(bannerLines(long)).toBeGreaterThan(2);
  });
});

describe("subject numbers", () => {
  it("flags a number past the player's", () => {
    expect(subjectNumberIssues("— Subject #68")).toHaveLength(1);
  });
  it("only the Exit Wing note may be signed #67", () => {
    expect(subjectNumberIssues("— Subject #67", "cell_block")).toHaveLength(1);
    expect(subjectNumberIssues("— Subject #67", "exit_wing")).toHaveLength(0);
  });
  it("lower numbers are fine anywhere", () => {
    expect(subjectNumberIssues("— Subject #19", "cell_block")).toHaveLength(0);
  });
});

describe("lintLine", () => {
  it("an empty required slot is bad; an empty optional one is silent", () => {
    expect(worstLevel(lintLine("", "dialog", { required: true }))).toBe("bad");
    expect(lintLine("", "dialog", { required: false })).toHaveLength(0);
  });
  it("a fitting banner line reports its size as ok", () => {
    const flags = lintLine("Playground time!", "banner");
    expect(worstLevel(flags)).toBe("ok");
    expect(flags[0].text).toMatch(/chars/);
  });
  it("an iceberg word is bad regardless of kind", () => {
    expect(worstLevel(lintLine("It's just a program.", "hint"))).toBe("bad");
  });
  it("a line under the 140-char budget that fits two lines is ok", () => {
    const line = "Good morning, Subject #67! Welcome to the PlayPen, where snack time is never and nap time is mandatory and the walls are your friends.";
    expect(line.length).toBeLessThan(140);
    expect(worstLevel(lintLine(line, "banner"))).toBe("ok");
  });
  it("a long banner line warns before it overflows", () => {
    // Over the soft budget but still two lines: a nudge, not a failure.
    const line = "Good morning, Subject #67! Welcome to the PlayPen, where snack time is never, nap time is mandatory, and the walls are your friends now. Please do not test that.";
    expect(line.length).toBeGreaterThan(140);
    expect(bannerLines(line)).toBeLessThanOrEqual(2);
    expect(worstLevel(lintLine(line, "banner"))).toBe("warn");
  });
});
