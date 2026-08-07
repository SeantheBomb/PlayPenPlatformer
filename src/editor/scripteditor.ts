// The penscript editor pane: a plain textarea with a token-colored highlight
// layer rendered behind it (transparent text + visible caret on top — the
// classic dependency-free trick), live compile errors, and hover tooltips.
// Tooltips are computed from monospace math: mouse position -> row/col ->
// token -> docs (keywords/events/builtins are static tables here; functions
// carry the doc string they were registered with; a behavior's own fields
// report where they're defined, which lines use them, and which attachments
// override them).
import { fnDoc, isKnownFn, TRIGGERS } from "../game/behavior";
import { compileScript, lintScript, type ScriptError } from "../game/penscript";
import { el } from "./forms";

const KEYWORD_DOCS: Record<string, string> = {
  var: "var name = value; — at the top level: a FIELD of this behavior (tweakable per attachment via params, persists per instance). Inside a handler: an ordinary local.",
  on: "on <event> { ... } — declare an event handler. Events: " + TRIGGERS.join(", "),
  if: "if (condition) { ... } else { ... }",
  else: "the other branch of an if",
  halt: "halt; — consume this whole dispatch: no further handlers or behaviors run for this host this event (an enemy's 'continue', an item's 'use is spent')",
  return: "return; — end this handler only; later behaviors still run",
  true: "boolean literal", false: "boolean literal",
  null: "no value — `x ?? fallback` substitutes fallbacks for it",
};

const EVENT_DOCS: Record<string, string> = {
  tick: "on tick — every fixed simulation step (60/s), for enemies and entities",
  flowTick: "on flowTick — every fluid-flow tick (braziers douse against pooled water here)",
  elementContact: "on elementContact(element) — an element was applied to this host (tool hit, hazard overlap, splash)",
  use: "on use(charge) — the player used this item with F (charge 0..1 for held throws)",
  heldTick: "on heldTick — every step while this item is the selected hotbar item",
  carriedTick: "on carriedTick — every step for this item anywhere in the inventory",
  // Policy hooks — the fluid/heat sims call these on the GLOBAL docs at
  // every decision point; the handler's decision functions write the answer.
  pickSide: "on pickSide — (fluidFlow) fluid must pick ONE side to try first (slide/squeeze/finite move). Decide with prefer(\"left\"|\"right\"|\"alternate\"); query terrain with sideDepth(). Silent handler = alternate.",
  sourcedSpread: "on sourcedSpread — (fluidFlow) a fall-fed surface tile widening its pool. Decide with spreadBoth() / spreadLeft() / spreadRight() / spreadNone().",
  fluidContact: "on fluidContact(mover, other) — (fluidFlow) two different fluids met; mover is the one that moved. Decide with destroyMover()/keepMover() and hardenOther(tileId?)/destroyOther()/keepOther().",
  meltChain: "on meltChain(depth) — (heatSpread) a lava melt consumed a tile `depth` tiles beyond direct lava contact. keepHot() chains the melt onward; a silent handler stops the chain here.",
  recede: "on recede(ratio) — (fluidFlow) a sourced tile was cut off from every fall (ratio 0 = at the gate, 1 = farthest). setDelay(ms) schedules when it dries.",
};

const BUILTIN_DOCS: Record<string, string> = {
  now: "now — simulated time in ms (replay-safe; never the wall clock)",
  host: "host.<field> — read the attached def's own fields (host.speed, host.igniteTo...)",
  state: 'state — this enemy\'s state ("patrol" | "chase" | "return" | "stunned" | "trapped" | "panicked", or your own); assignable',
  lit: "lit — this entity's flame state (braziers); assignable",
  player: "player — moveToward target: the player's position",
  home: "home — moveToward target: this enemy's spawn post",
};

type TokKind =
  | "comment" | "string" | "number" | "keyword" | "event"
  | "builtin" | "fn" | "badfn" | "field" | "ident" | "punct";

interface HlTok {
  kind: TokKind;
  text: string;
  /** column of the first character (0-based) */
  col: number;
}

const TOKEN_RE = /\/\/.*$|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|\d[\d_]*(?:\.\d+)?|[A-Za-z_]\w*|\s+|./gm;

function tokenizeLine(line: string, fieldNames: Set<string>): HlTok[] {
  const out: HlTok[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let prevWord = "";
  while ((m = TOKEN_RE.exec(line)) !== null) {
    const text = m[0];
    const col = m.index;
    let kind: TokKind = "punct";
    const c = text[0];
    if (text.startsWith("//")) kind = "comment";
    else if (c === '"' || c === "'") kind = "string";
    else if (/\d/.test(c)) kind = "number";
    else if (/[A-Za-z_]/.test(c)) {
      const rest = line.slice(m.index + text.length);
      const isCall = /^\s*\(/.test(rest);
      if (KEYWORD_DOCS[text] !== undefined) kind = "keyword";
      else if (prevWord === "on" && EVENT_DOCS[text] !== undefined) kind = "event";
      else if (isCall) kind = isKnownFn(text) ? "fn" : "badfn";
      else if (BUILTIN_DOCS[text] !== undefined && prevWord !== ".") kind = "builtin";
      else if (fieldNames.has(text) && prevWord !== ".") kind = "field";
      else kind = "ident";
      prevWord = text;
    } else if (!/^\s+$/.test(text)) {
      prevWord = text;
    }
    out.push({ kind, text, col });
  }
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A compile/lint error anchored to a real span (see ScriptError.col/len). */
interface ErrSpan { col: number; len: number }

/**
 * Render one line's tokens, wrapping any that overlap an error span with an
 * extra "pp-tk-err" class (wavy red underline, layered onto the token's own
 * color via CSS — see .pp-tk-err). An error whose span lands entirely on
 * whitespace/EOF past the last real token (the common "expected X before end
 * of script" case) falls back to marking the LAST real token on the line, so
 * every reported error is visible somewhere on its line even when its exact
 * column has nothing to underline. A line with no tokens at all (blank, but
 * still implicated) gets a small synthetic marker instead of nothing.
 */
function highlightHtml(
  source: string, fieldNames: Set<string>, errorsByLine: Map<number, ErrSpan[]>
): string {
  const lines = source.split("\n");
  return lines.map((line, idx) => {
    const ranges = errorsByLine.get(idx + 1) ?? [];
    const toks = tokenizeLine(line, fieldNames);
    let markedAny = false;
    let lastRealIdx = -1;
    const parts = toks.map((t, i) => {
      const isWs = t.kind === "punct" && /^\s+$/.test(t.text);
      if (!isWs) lastRealIdx = i;
      const tokEnd = t.col + t.text.length;
      const hit = ranges.some((r) => r.col < tokEnd && r.col + r.len > t.col);
      if (hit) markedAny = true;
      if (isWs && !hit) return esc(t.text);
      return `<span class="pp-tk-${t.kind}${hit ? " pp-tk-err" : ""}">${esc(t.text)}</span>`;
    });
    if (ranges.length > 0 && !markedAny) {
      if (lastRealIdx >= 0) {
        const t = toks[lastRealIdx];
        parts[lastRealIdx] = `<span class="pp-tk-${t.kind} pp-tk-err">${esc(t.text)}</span>`;
      } else {
        parts.push('<span class="pp-tk-ident pp-tk-err">&nbsp;</span>');
      }
    }
    return parts.join("");
  }).join("\n") + "\n";
}

export interface ScriptEditorCtx {
  /** Every doc's script, for "also used in" lookups: [id, source]. */
  allScripts(): [string, string][];
  /** Human lines describing attachments that override a field of THIS doc. */
  fieldOverrides(field: string): string[];
}

// Undo/redo: a plain textarea's NATIVE undo is unreliable here — a burst of
// rapid typing gets coalesced inconsistently across browsers, blur can drop
// history, and any programmatic `.value =` write (external content reload,
// future "revert" buttons) silently WIPES it, since only real typed input is
// undo-tracked. So this editor owns its own stack instead of trusting the
// browser's. Rapid typing coalesces into one undo step after a short pause
// (DEBOUNCE_MS) — same feel as VS Code/most editors — rather than one entry
// per keystroke, which would make Ctrl+Z tediously granular.
const UNDO_DEBOUNCE_MS = 600;
const UNDO_MAX = 200;

export function createScriptEditor(opts: {
  source: string;
  onChange: (source: string, clean: boolean) => void;
  ctx: ScriptEditorCtx;
}): HTMLElement {
  let source = opts.source;
  let fieldDefs = new Map<string, number>(); // field -> defining line (1-based)
  let lastErrors: ScriptError[] = [];
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let lastCommitted = source;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const gutterPre = el("pre", { className: "pp-codegutter-pre" });
  const gutterWrap = el("div", { className: "pp-codegutter" }, gutterPre);
  const hl = el("pre", { className: "pp-codehl" });
  const ta = el("textarea", {
    className: "pp-codeta", spellcheck: false, wrap: "off", value: source,
  });
  const codeArea = el("div", { className: "pp-codearea" }, hl, ta);
  const errorsEl = el("div", { className: "pp-hint", style: "margin-top:4px" });
  const tooltip = el("div", { className: "pp-tooltip", style: "display:none" });
  const wrap = el("div", { className: "pp-codewrap" }, gutterWrap, codeArea);

  const recompile = (): boolean => {
    const { script, errors } = compileScript(source);
    fieldDefs = new Map();
    if (script) for (const f of script.fields) fieldDefs.set(f.name, f.line);
    const all: ScriptError[] = [...errors];
    if (script && errors.length === 0) {
      all.push(...lintScript(script, TRIGGERS, isKnownFn));
    }
    lastErrors = all;
    errorsEl.replaceChildren(
      ...(all.length === 0
        ? [el("span", { style: "color:#9be8b0" }, "✓ compiles clean")]
        : all.slice(0, 6).map((e) =>
            el("div", { style: "color:#ff9db0" }, `line ${e.line}: ${e.message}`)))
    );
    if (all.length > 6) {
      errorsEl.append(el("div", { style: "color:#8f87ad" }, `…and ${all.length - 6} more`));
    }
    wrap.classList.toggle("pp-bad", all.length > 0);
    return all.length === 0;
  };

  const render = () => {
    const lines = source.split("\n");
    gutterPre.textContent = lines.map((_, i) => String(i + 1)).join("\n");
    const errorsByLine = new Map<number, ErrSpan[]>();
    for (const e of lastErrors) {
      if (e.col === undefined) continue;
      const arr = errorsByLine.get(e.line) ?? [];
      arr.push({ col: e.col, len: Math.max(1, e.len ?? 1) });
      errorsByLine.set(e.line, arr);
    }
    hl.innerHTML = highlightHtml(source, new Set(fieldDefs.keys()), errorsByLine);
  };

  /** Commit whatever's pending as one undo step right now (used before an
   *  undo/redo, and on blur, so a just-typed burst is never silently lost). */
  const flushPending = (): void => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (source === lastCommitted) return;
    undoStack.push(lastCommitted);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    lastCommitted = source;
    redoStack.length = 0;
  };

  /** Push new content into the editor from OUTSIDE user typing (undo/redo
   *  results) — the one path allowed to write ta.value directly. */
  const applyExternal = (text: string): void => {
    source = text;
    ta.value = text;
    lastCommitted = text;
    const clean = recompile();
    render();
    opts.onChange(source, clean);
  };

  const performUndo = (): void => {
    flushPending();
    const prev = undoStack.pop();
    if (prev === undefined) return;
    redoStack.push(source);
    applyExternal(prev);
  };
  const performRedo = (): void => {
    const next = redoStack.pop();
    if (next === undefined) return;
    undoStack.push(source);
    applyExternal(next);
  };

  ta.addEventListener("input", () => {
    source = ta.value;
    const clean = recompile();
    render();
    opts.onChange(source, clean);
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flushPending, UNDO_DEBOUNCE_MS);
  });
  ta.addEventListener("blur", flushPending);
  ta.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const key = ev.key.toLowerCase();
    if (key === "z" && !ev.shiftKey) {
      ev.preventDefault();
      performUndo();
    } else if (key === "y" || (key === "z" && ev.shiftKey)) {
      ev.preventDefault();
      performRedo();
    }
  });
  ta.addEventListener("scroll", () => {
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    gutterPre.style.transform = `translateY(${-ta.scrollTop}px)`;
  });

  // ---- hover tooltips (monospace math: mouse -> row/col -> token) ----
  let metrics: { charW: number; lineH: number; padX: number; padY: number } | null = null;
  const measure = () => {
    const cs = getComputedStyle(ta);
    const canvas = document.createElement("canvas");
    const c2d = canvas.getContext("2d")!;
    c2d.font = `${cs.fontSize} ${cs.fontFamily}`;
    metrics = {
      charW: c2d.measureText("M").width,
      lineH: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4,
      padX: parseFloat(cs.paddingLeft) || 0,
      padY: parseFloat(cs.paddingTop) || 0,
    };
  };

  const tooltipFor = (word: string, kind: TokKind, line: number): string | null => {
    if (kind === "keyword") return KEYWORD_DOCS[word] ?? null;
    if (kind === "event") return EVENT_DOCS[word] ?? null;
    if (kind === "builtin") return BUILTIN_DOCS[word] ?? null;
    if (kind === "fn" || kind === "badfn") {
      if (!isKnownFn(word)) return `unknown function "${word}" — see the legend below for what's available`;
      const usedIn = opts.ctx.allScripts()
        .filter(([, src]) => new RegExp(`\\b${word}\\s*\\(`).test(src))
        .map(([id]) => id);
      const doc = fnDoc(word) || `${word}(...) — engine function`;
      return `${doc}\n\nengine function · also used in: ${usedIn.length ? usedIn.join(", ") : "only here"}`;
    }
    if (kind === "field" || kind === "ident") {
      const def = fieldDefs.get(word);
      if (def !== undefined) {
        const uses = source.split("\n")
          .map((l, i) => (i + 1 !== def && new RegExp(`\\b${word}\\b`).test(l.split("//")[0]) ? i + 1 : 0))
          .filter(Boolean);
        const overrides = opts.ctx.fieldOverrides(word);
        return [
          `${word} — field of this behavior (defined line ${def})`,
          `used on: ${uses.length ? "line " + uses.join(", ") : "nowhere else"}`,
          overrides.length ? `overridden by: ${overrides.join(" · ")}` : "no attachment overrides",
        ].join("\n");
      }
      if (kind === "ident") return `${word} — local variable or handler parameter (line ${line})`;
    }
    return null;
  };

  ta.addEventListener("mousemove", (ev) => {
    if (!metrics) measure();
    const r = ta.getBoundingClientRect();
    const x = ev.clientX - r.left - metrics!.padX + ta.scrollLeft;
    const y = ev.clientY - r.top - metrics!.padY + ta.scrollTop;
    const row = Math.floor(y / metrics!.lineH);
    const col = Math.floor(x / metrics!.charW);
    const lines = source.split("\n");
    const line = lines[row];
    let text: string | null = null;
    // A squiggled span's own message takes priority — hovering the red
    // underline should tell you what's wrong, same as any code editor.
    const errHere = lastErrors
      .filter((e) => e.line === row + 1 && e.col !== undefined &&
        col >= e.col && col < e.col + Math.max(1, e.len ?? 1))
      .map((e) => "⚠ " + e.message);
    if (line !== undefined && col >= 0) {
      const toks = tokenizeLine(line, new Set(fieldDefs.keys()));
      const tok = toks.find((t) => col >= t.col && col < t.col + t.text.length);
      if (tok && !/^\s+$/.test(tok.text)) {
        text = tooltipFor(tok.text, tok.kind, row + 1);
      }
    }
    const combined = errHere.length > 0
      ? errHere.join("\n") + (text ? "\n\n" + text : "")
      : text;
    if (combined) {
      tooltip.textContent = combined;
      tooltip.style.display = "block";
      const pad = 14;
      tooltip.style.left = Math.min(ev.clientX + pad, window.innerWidth - 340) + "px";
      tooltip.style.top = ev.clientY + pad + "px";
    } else {
      tooltip.style.display = "none";
    }
  });
  ta.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });

  document.body.append(tooltip);
  // Clean the floating tooltip up when the editor pane is torn down.
  const obs = new MutationObserver(() => {
    if (!document.body.contains(wrap)) {
      tooltip.remove();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  recompile();
  render();
  return el("div", {}, wrap, errorsEl);
}
