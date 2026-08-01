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
};

const BUILTIN_DOCS: Record<string, string> = {
  now: "now — simulated time in ms (replay-safe; never the wall clock)",
  host: "host.<field> — read the attached def's own fields (host.speed, host.igniteTo...)",
  state: 'state — this enemy\'s state ("patrol" | "chase" | "return" | "stunned" | "trapped", or your own); assignable',
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

function highlightHtml(source: string, fieldNames: Set<string>): string {
  return source.split("\n").map((line) =>
    tokenizeLine(line, fieldNames)
      .map((t) =>
        t.kind === "punct" && /^\s+$/.test(t.text)
          ? esc(t.text)
          : `<span class="pp-tk-${t.kind}">${esc(t.text)}</span>`
      )
      .join("")
  ).join("\n") + "\n";
}

export interface ScriptEditorCtx {
  /** Every doc's script, for "also used in" lookups: [id, source]. */
  allScripts(): [string, string][];
  /** Human lines describing attachments that override a field of THIS doc. */
  fieldOverrides(field: string): string[];
}

export function createScriptEditor(opts: {
  source: string;
  onChange: (source: string, clean: boolean) => void;
  ctx: ScriptEditorCtx;
}): HTMLElement {
  let source = opts.source;
  let fieldDefs = new Map<string, number>(); // field -> defining line (1-based)

  const hl = el("pre", { className: "pp-codehl" });
  const ta = el("textarea", {
    className: "pp-codeta", spellcheck: false, wrap: "off", value: source,
  });
  const errorsEl = el("div", { className: "pp-hint", style: "margin-top:4px" });
  const tooltip = el("div", { className: "pp-tooltip", style: "display:none" });
  const wrap = el("div", { className: "pp-codewrap" }, hl, ta);

  const recompile = (): boolean => {
    const { script, errors } = compileScript(source);
    fieldDefs = new Map();
    if (script) for (const f of script.fields) fieldDefs.set(f.name, f.line);
    const all: ScriptError[] = [...errors];
    if (script && errors.length === 0) {
      all.push(...lintScript(script, TRIGGERS, isKnownFn));
    }
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
    hl.innerHTML = highlightHtml(source, new Set(fieldDefs.keys()));
  };

  ta.addEventListener("input", () => {
    source = ta.value;
    const clean = recompile();
    render();
    opts.onChange(source, clean);
  });
  ta.addEventListener("scroll", () => {
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
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
    if (line !== undefined && col >= 0) {
      const toks = tokenizeLine(line, new Set(fieldDefs.keys()));
      const tok = toks.find((t) => col >= t.col && col < t.col + t.text.length);
      if (tok && !/^\s+$/.test(tok.text)) {
        text = tooltipFor(tok.text, tok.kind, row + 1);
      }
    }
    if (text) {
      tooltip.textContent = text;
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
