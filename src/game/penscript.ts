// penscript — PlayPen's behavior scripting language.
//
// A deliberately small, TypeScript/C#-flavored language for content-authored
// behavior: braces, `var`, `if/else`, expressions (`??`, `&&`, `||`, ternary,
// arithmetic, comparisons), `//` comments, and `on <event>` handler blocks.
// No loops, no user functions, no I/O — every capability comes from engine
// functions registered with the behavior runtime, which is what keeps scripts
// replay-deterministic by construction (there is no wall clock or Math.random
// to reach for).
//
// A script is the BODY of a behavior (the surrounding doc provides id/host/
// tags). Top-level `var`s are the behavior's tweakable fields — evaluated per
// attached instance, overridable per attachment (Unity public-field model) —
// and double as per-instance state when handlers assign to them. `var` inside
// a handler is an ordinary local.
//
//   var range  = host.sightRange ?? 120;   // field (per-attachment tunable)
//   var seenAt = 0;                        // field (per-instance state)
//
//   on tick {
//     if (seesPlayer(range)) { state = "chase"; seenAt = now; }
//   }
//   on elementContact(element) {
//     if (element == "water") { halt; }    // consume the event entirely
//   }
//
// This module is pure syntax: lexer, parser, AST. Evaluation lives in
// behavior.ts, which owns the function registry and builtins.

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "null" }
  | { k: "ident"; name: string; line: number }
  | { k: "member"; obj: Expr; prop: string; line: number }
  | { k: "call"; name: string; args: Expr[]; line: number; col: number }
  | { k: "un"; op: "!" | "-"; e: Expr }
  | { k: "bin"; op: BinOp; l: Expr; r: Expr; line: number }
  | { k: "cond"; c: Expr; t: Expr; f: Expr };

export type BinOp =
  | "??" | "||" | "&&"
  | "==" | "!="
  | "<" | ">" | "<=" | ">="
  | "+" | "-" | "*" | "/" | "%";

export type Stmt =
  | { k: "var"; name: string; init: Expr; line: number }
  | { k: "assign"; name: string; e: Expr; line: number }
  | { k: "if"; c: Expr; then: Stmt[]; else?: Stmt[]; line: number }
  | { k: "expr"; e: Expr; line: number }
  | { k: "halt"; line: number }
  | { k: "return"; line: number };

export interface Handler {
  event: string;
  /** Payload bindings, bound by NAME from the trigger's data (e.g. element). */
  params: string[];
  body: Stmt[];
  line: number;
  /** Column of the event name (line 20: `on tick`'s "tick" starts here) —
   *  editor squiggle placement for "unknown event" lints. */
  col: number;
}

export interface CompiledScript {
  /** Top-level fields: tweakable defaults + per-instance state. */
  fields: { name: string; init: Expr; line: number }[];
  handlers: Handler[];
}

export interface ScriptError {
  line: number;
  message: string;
  /** 0-based column and character length of the offending span, when known
   *  — lets the editor draw a squiggle at the actual location instead of
   *  just listing the line. Absent for a few generic fallback errors. */
  col?: number;
  len?: number;
}

export interface CompileResult {
  script: CompiledScript | null;
  errors: ScriptError[];
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

interface Tok {
  kind: "ident" | "num" | "str" | "punct" | "eof";
  text: string;
  num?: number;
  line: number;
  /** 0-based column of the token's first character on its line. */
  col: number;
}

const PUNCTS = [
  "??", "||", "&&", "==", "!=", "<=", ">=",
  "{", "}", "(", ")", ",", ";", "=", "<", ">", "+", "-", "*", "/", "%",
  "!", ".", "?", ":",
];

function lex(src: string): { toks: Tok[]; errors: ScriptError[] } {
  const toks: Tok[] = [];
  const errors: ScriptError[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0; // index of the current line's first character in src
  const n = src.length;
  const col = (at: number) => at - lineStart;
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; lineStart = i; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    const tokStart = i;
    const tokCol = col(tokStart);
    if (c === '"' || c === "'") {
      const quote = c;
      let s = "";
      i++;
      let closed = false;
      while (i < n) {
        const ch = src[i];
        if (ch === "\\" && i + 1 < n) {
          const esc = src[i + 1];
          s += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
          i += 2;
          continue;
        }
        if (ch === quote) { closed = true; i++; break; }
        if (ch === "\n") break;
        s += ch;
        i++;
      }
      if (!closed) {
        errors.push({ line, col: tokCol, len: Math.max(1, i - tokStart), message: "unterminated string" });
      }
      toks.push({ kind: "str", text: s, line, col: tokCol });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let s = "";
      while (i < n && /[0-9._]/.test(src[i])) { s += src[i]; i++; }
      const v = parseFloat(s.replace(/_/g, ""));
      if (Number.isNaN(v)) {
        errors.push({ line, col: tokCol, len: s.length, message: `bad number "${s}"` });
      }
      toks.push({ kind: "num", text: s, num: v, line, col: tokCol });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = "";
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) { s += src[i]; i++; }
      toks.push({ kind: "ident", text: s, line, col: tokCol });
      continue;
    }
    const two = src.slice(i, i + 2);
    const p = PUNCTS.includes(two) ? two : PUNCTS.includes(c) ? c : null;
    if (p === null) {
      errors.push({ line, col: tokCol, len: 1, message: `unexpected character "${c}"` });
      i++;
      continue;
    }
    toks.push({ kind: "punct", text: p, line, col: tokCol });
    i += p.length;
  }
  toks.push({ kind: "eof", text: "", line, col: col(i) });
  return { toks, errors };
}

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;
  errors: ScriptError[] = [];

  constructor(private toks: Tok[]) {}

  private peek(): Tok { return this.toks[this.pos]; }
  private next(): Tok { return this.toks[this.pos++]; }
  private atPunct(p: string): boolean {
    const t = this.peek();
    return t.kind === "punct" && t.text === p;
  }
  private atIdent(name?: string): boolean {
    const t = this.peek();
    return t.kind === "ident" && (name === undefined || t.text === name);
  }
  /** Push an error anchored at token `t`'s actual position — the squiggle
   *  the editor draws lands on the real offending span, not just "the line". */
  private errAt(t: Tok, message: string): void {
    this.errors.push({ line: t.line, col: t.col, len: Math.max(1, t.text.length), message });
  }
  private expectPunct(p: string): boolean {
    if (this.atPunct(p)) { this.next(); return true; }
    const t = this.peek();
    this.errAt(t, `expected "${p}"${t.kind === "eof" ? " before end of script" : ` but found "${t.text}"`}`);
    return false;
  }
  private expectIdent(what: string): Tok | null {
    if (this.peek().kind === "ident") return this.next();
    const t = this.peek();
    this.errAt(t, `expected ${what} but found "${t.text || "end of script"}"`);
    return null;
  }
  /** Optional semicolon — statements are brace/line structured; a ";" is
   *  accepted (TS/C# habit) but never required. */
  private eatSemi(): void {
    while (this.atPunct(";")) this.next();
  }
  /** Skip forward to a likely statement boundary after an error. */
  private synchronize(): void {
    while (this.peek().kind !== "eof") {
      const t = this.peek();
      if (t.kind === "punct" && (t.text === ";" || t.text === "}")) { this.next(); return; }
      if (t.kind === "ident" && ["var", "on", "if", "halt", "return"].includes(t.text)) return;
      this.next();
    }
  }

  parseScript(): CompiledScript {
    const fields: CompiledScript["fields"] = [];
    const handlers: Handler[] = [];
    while (this.peek().kind !== "eof") {
      this.eatSemi();
      if (this.peek().kind === "eof") break;
      const before = this.pos;
      if (this.atIdent("var")) {
        const line = this.peek().line;
        const v = this.parseVar();
        if (v) fields.push({ name: v.name, init: v.init, line });
      } else if (this.atIdent("on")) {
        const h = this.parseHandler();
        if (h) handlers.push(h);
      } else {
        const t = this.peek();
        this.errAt(t, `expected "var" or "on" at top level, found "${t.text}"`);
        this.synchronize();
      }
      // Recovery must always advance — synchronize can legally stop at a
      // statement keyword the top level can't parse (e.g. a stray "if"),
      // which would otherwise loop here forever on a malformed script.
      if (this.pos === before) this.next();
    }
    return { fields, handlers };
  }

  private parseVar(): { name: string; init: Expr } | null {
    this.next(); // var
    const name = this.expectIdent("a variable name");
    if (!name) { this.synchronize(); return null; }
    if (!this.expectPunct("=")) { this.synchronize(); return null; }
    const init = this.parseExpr();
    this.eatSemi();
    return { name: name.text, init };
  }

  private parseHandler(): Handler | null {
    const onTok = this.next(); // on
    const ev = this.expectIdent("an event name (tick, use, elementContact...)");
    if (!ev) { this.synchronize(); return null; }
    const params: string[] = [];
    if (this.atPunct("(")) {
      this.next();
      while (!this.atPunct(")") && this.peek().kind !== "eof") {
        const p = this.expectIdent("a parameter name");
        if (!p) break;
        params.push(p.text);
        if (this.atPunct(",")) this.next();
      }
      this.expectPunct(")");
    }
    if (!this.expectPunct("{")) { this.synchronize(); return null; }
    const body = this.parseBlockBody();
    return { event: ev.text, params, body, line: onTok.line, col: ev.col };
  }

  /** Statements until the matching "}" (which is consumed). */
  private parseBlockBody(): Stmt[] {
    const out: Stmt[] = [];
    while (!this.atPunct("}") && this.peek().kind !== "eof") {
      const before = this.pos;
      const s = this.parseStmt();
      if (s) out.push(s);
      this.eatSemi();
      if (this.pos === before) this.next(); // never stall on malformed input
    }
    this.expectPunct("}");
    return out;
  }

  private parseStmt(): Stmt | null {
    const t = this.peek();
    if (this.atIdent("var")) {
      const v = this.parseVar();
      return v ? { k: "var", name: v.name, init: v.init, line: t.line } : null;
    }
    if (this.atIdent("if")) return this.parseIf();
    if (this.atIdent("halt")) { this.next(); this.eatSemi(); return { k: "halt", line: t.line }; }
    if (this.atIdent("return")) { this.next(); this.eatSemi(); return { k: "return", line: t.line }; }
    // Assignment (ident = expr) or expression statement (usually a call).
    if (t.kind === "ident" && this.toks[this.pos + 1]?.kind === "punct" && this.toks[this.pos + 1].text === "=") {
      const name = this.next().text;
      this.next(); // =
      const e = this.parseExpr();
      this.eatSemi();
      return { k: "assign", name, e, line: t.line };
    }
    const e = this.parseExpr();
    this.eatSemi();
    if (e.k === "ident" || e.k === "member" || e.k === "num" || e.k === "str") {
      this.errAt(t, `this line has no effect — did you mean a call (add "()") or an assignment (add "= value")?`);
    }
    return { k: "expr", e, line: t.line };
  }

  private parseIf(): Stmt | null {
    const line = this.peek().line;
    this.next(); // if
    if (!this.expectPunct("(")) { this.synchronize(); return null; }
    const c = this.parseExpr();
    this.expectPunct(")");
    let then: Stmt[];
    if (this.atPunct("{")) { this.next(); then = this.parseBlockBody(); }
    else { const s = this.parseStmt(); then = s ? [s] : []; }
    let els: Stmt[] | undefined;
    if (this.atIdent("else")) {
      this.next();
      if (this.atIdent("if")) {
        const chained = this.parseIf();
        els = chained ? [chained] : [];
      } else if (this.atPunct("{")) {
        this.next();
        els = this.parseBlockBody();
      } else {
        const s = this.parseStmt();
        els = s ? [s] : [];
      }
    }
    return { k: "if", c, then, else: els, line };
  }

  // ---- expressions, by precedence ----

  parseExpr(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    const c = this.parseCoalesce();
    if (this.atPunct("?")) {
      this.next();
      const t = this.parseExpr();
      this.expectPunct(":");
      const f = this.parseExpr();
      return { k: "cond", c, t, f };
    }
    return c;
  }

  private parseBinLevel(ops: BinOp[], sub: () => Expr): Expr {
    let l = sub();
    for (;;) {
      const t = this.peek();
      if (t.kind === "punct" && (ops as string[]).includes(t.text)) {
        this.next();
        const r = sub();
        l = { k: "bin", op: t.text as BinOp, l, r, line: t.line };
      } else {
        return l;
      }
    }
  }

  private parseCoalesce(): Expr { return this.parseBinLevel(["??"], () => this.parseOr()); }
  private parseOr(): Expr { return this.parseBinLevel(["||"], () => this.parseAnd()); }
  private parseAnd(): Expr { return this.parseBinLevel(["&&"], () => this.parseEquality()); }
  private parseEquality(): Expr { return this.parseBinLevel(["==", "!="], () => this.parseCompare()); }
  private parseCompare(): Expr { return this.parseBinLevel(["<", ">", "<=", ">="], () => this.parseAdd()); }
  private parseAdd(): Expr { return this.parseBinLevel(["+", "-"], () => this.parseMul()); }
  private parseMul(): Expr { return this.parseBinLevel(["*", "/", "%"], () => this.parseUnary()); }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === "punct" && (t.text === "!" || t.text === "-")) {
      this.next();
      return { k: "un", op: t.text as "!" | "-", e: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.atPunct(".")) {
        const dot = this.next();
        const prop = this.expectIdent("a property name after '.'");
        if (!prop) return e;
        e = { k: "member", obj: e, prop: prop.text, line: dot.line };
        continue;
      }
      return e;
    }
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (t.kind === "num") return { k: "num", v: t.num ?? 0 };
    if (t.kind === "str") return { k: "str", v: t.text };
    if (t.kind === "ident") {
      if (t.text === "true") return { k: "bool", v: true };
      if (t.text === "false") return { k: "bool", v: false };
      if (t.text === "null") return { k: "null" };
      if (this.atPunct("(")) {
        this.next();
        const args: Expr[] = [];
        while (!this.atPunct(")") && this.peek().kind !== "eof") {
          args.push(this.parseExpr());
          if (this.atPunct(",")) this.next();
        }
        this.expectPunct(")");
        return { k: "call", name: t.text, args, line: t.line, col: t.col };
      }
      return { k: "ident", name: t.text, line: t.line };
    }
    if (t.kind === "punct" && t.text === "(") {
      const e = this.parseExpr();
      this.expectPunct(")");
      return e;
    }
    this.errAt(t, `expected a value but found "${t.text || "end of script"}"`);
    return { k: "null" };
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function compileScript(source: string): CompileResult {
  const { toks, errors } = lex(source);
  const parser = new Parser(toks);
  const script = parser.parseScript();
  const all = [...errors, ...parser.errors];
  return { script: all.length === 0 ? script : script, errors: all };
}

/** Static sanity pass beyond syntax: unknown handler events and (optionally)
 *  unknown function names — surfaced in the editor, never fatal at runtime. */
export function lintScript(
  compiled: CompiledScript,
  knownEvents: string[],
  knownFns: (name: string) => boolean
): ScriptError[] {
  const out: ScriptError[] = [];
  for (const h of compiled.handlers) {
    if (!knownEvents.includes(h.event)) {
      out.push({
        line: h.line, col: h.col, len: Math.max(1, h.event.length),
        message: `unknown event "${h.event}" (known: ${knownEvents.join(", ")})`,
      });
    }
  }
  const walkExpr = (e: Expr): void => {
    switch (e.k) {
      case "call":
        if (!knownFns(e.name)) {
          out.push({
            line: e.line, col: e.col, len: Math.max(1, e.name.length),
            message: `unknown function "${e.name}"`,
          });
        }
        e.args.forEach(walkExpr);
        break;
      case "member": walkExpr(e.obj); break;
      case "un": walkExpr(e.e); break;
      case "bin": walkExpr(e.l); walkExpr(e.r); break;
      case "cond": walkExpr(e.c); walkExpr(e.t); walkExpr(e.f); break;
      default: break;
    }
  };
  const walkStmts = (stmts: Stmt[]): void => {
    for (const s of stmts) {
      if (s.k === "var") walkExpr(s.init);
      if (s.k === "assign") walkExpr(s.e);
      if (s.k === "expr") walkExpr(s.e);
      if (s.k === "if") {
        walkExpr(s.c);
        walkStmts(s.then);
        if (s.else) walkStmts(s.else);
      }
    }
  };
  for (const f of compiled.fields) walkExpr(f.init);
  for (const h of compiled.handlers) walkStmts(h.body);
  return out;
}
