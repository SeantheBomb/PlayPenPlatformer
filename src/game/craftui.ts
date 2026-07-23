// The crafting overlay ("Workbench of Questionable Science").
//
// Combine two materials — drag one onto another, or pick two — to craft. A
// successful combine celebrates (pop + sparks + ring + chime); a mismatch
// shakes the two culprits. Recipes discovered by experimentation are added to
// the journal and flagged NEW until the menu closes. Equipment can be broken
// back into its ingredients. Keyboard, gamepad, mouse and touch all work.
//
// Everything draws and hit-tests in RAW CANVAS-PIXEL space (identity transform),
// not the logical 640x360 view. On desktop the layout is the classic design
// mapped 1:1 through the view scale (visually identical to before); on compact
// touch screens the panel fills most of the landscape screen so slots and text
// stay physically large enough to tap. Pointer coords arrive already in
// canvas-pixel space (see game.ts + touch.ts).
import type { Content, ItemDef } from "../data/types";
import type { Input } from "../engine/input";
import { drawItemIcon, roundRect } from "../engine/renderer";
import { sfx } from "../engine/audio";
import type { RunState } from "./state";
import { tryCraft, tryDismantle, type CraftResult } from "./crafting";

// Classic logical design (mapped by view scale on desktop).
const COLS = 5;
const PANEL_W = 560;
const PANEL_H = 308;
const PX = (640 - PANEL_W) / 2;
const PY = (360 - PANEL_H) / 2;

interface Rect { x: number; y: number; w: number; h: number; }

interface Layout {
  compact: boolean;
  ox: number; oy: number; w: number; h: number;
  cols: number;
  slot: number; step: number;
  gridX: number; gridY: number;
  equipX: number; equipY: number; equipSlot: number; equipStep: number;
  journalX: number; journalY: number; journalW: number; journalH: number;
  close: Rect;
  dismantle: Rect;
  msgX: number; msgY: number; msgW: number;
  resultCX: number; resultCY: number;   // center of the success pop
  icon: number;                          // base icon-scale unit
  f: { title: number; sub: number; label: number; body: number; name: number; badge: number };
}

interface Slot { item: ItemDef; count: number; }

/** Pointer-originated craft actions, recorded semantically for replay. */
export type CraftPointerOp =
  | { op: "pick"; i: number }
  | { op: "combine"; a: string; b: string }
  | { op: "selequip"; id: string }
  | { op: "dismantle"; id: string }
  | { op: "close" };

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; }

const c1 = 1.70158;
const c3 = c1 + 1;
function easeOutBack(t: number): number {
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class CraftUI {
  open = false;
  /** Session recording taps pointer-originated craft actions here. */
  onPointerOp?: (op: CraftPointerOp) => void;
  private cursor = 0;
  private firstPick: number | null = null;
  private message = "";
  private messageColor = "#bbb3d6";
  private selectedEquip: string | null = null; // item id picked on the shelf

  // Pointer drag state (canvas-pixel space)
  private downIdx: number | null = null;
  private downX = 0;
  private downY = 0;
  private dragIdx: number | null = null;
  private dragX = 0;
  private dragY = 0;

  // Viewport (canvas-pixel), set by the game each frame.
  private vp = { compact: false, cw: 640, ch: 360, s: 1, ox: 0, oy: 0 };

  // Juice / feedback timers (performance.now() based)
  private now = 0;
  private lastDraw = 0;
  private fxSuccessAt = -1;
  private fxResult: ItemDef | null = null;
  private fxFailAt = -1;
  private fxFailIds: string[] = [];
  private fxBannerAt = -1;
  private fxBannerText = "";
  private sparks: Spark[] = [];
  private newRecipeIds = new Set<string>(); // discovered this session, glow until close

  constructor(
    private content: Content,
    private onResult: (r: CraftResult, a: string, b: string) => void
  ) {}

  setContent(content: Content): void {
    this.content = content;
  }

  /** Called by the game whenever the viewport changes (canvas-pixel space). */
  setViewport(compact: boolean, cw: number, ch: number, s: number, ox: number, oy: number): void {
    this.vp = { compact, cw, ch, s, ox, oy };
  }

  private materials(state: RunState): Slot[] {
    const out: Slot[] = [];
    for (const [id, count] of state.inventory) {
      if (count <= 0) continue;
      const item = this.content.items.find((i) => i.id === id);
      if (item?.kind === "material") out.push({ item, count });
    }
    out.sort((a, b) => a.item.name.localeCompare(b.item.name));
    return out;
  }

  private equipment(state: RunState): Slot[] {
    const out: Slot[] = [];
    for (const [id, count] of state.inventory) {
      if (count <= 0) continue;
      const item = this.content.items.find((i) => i.id === id);
      if (item && item.kind !== "material") out.push({ item, count });
    }
    out.sort((a, b) => a.item.name.localeCompare(b.item.name));
    return out;
  }

  show(): void {
    this.open = true;
    this.cursor = 0;
    this.firstPick = null;
    this.dragIdx = null;
    this.downIdx = null;
    this.message = "Combine two materials. Drag one onto another, or pick twice.";
    this.messageColor = "#bbb3d6";
    this.selectedEquip = null;
    this.fxSuccessAt = -1;
    this.fxFailAt = -1;
    this.fxBannerAt = -1;
    this.sparks = [];
    this.newRecipeIds.clear();
  }

  hide(): void {
    this.open = false;
    this.newRecipeIds.clear();
  }

  // ---------- layout ----------

  private layout(): Layout {
    const { compact, cw, ch, s, ox, oy } = this.vp;
    if (!compact) {
      // Classic design, mapped 1:1 into canvas pixels through the view scale.
      const L = (v: number) => v * s;
      const cx = (lx: number) => lx * s + ox;
      const cy = (ly: number) => ly * s + oy;
      const gridX = cx(PX + 14), gridY = cy(PY + 56);
      const equipY = cy(PY + 190);
      return {
        compact: false,
        ox: cx(PX), oy: cy(PY), w: L(PANEL_W), h: L(PANEL_H),
        cols: COLS, slot: L(34), step: L(38),
        gridX, gridY,
        equipX: gridX, equipY, equipSlot: L(30), equipStep: L(34),
        journalX: cx(PX + 370), journalY: cy(PY + 46), journalW: L(176), journalH: L(248),
        close: { x: cx(PX + 532), y: cy(PY + 8), w: L(20), h: L(20) },
        dismantle: { x: gridX, y: cy(PY + 224), w: L(108), h: L(18) },
        msgX: gridX, msgY: cy(PY + 252), msgW: L(340),
        resultCX: cx(320), resultCY: cy(150),
        icon: s,
        f: { title: L(12), sub: L(9), label: L(9), body: L(10), name: L(8), badge: L(8) },
      };
    }
    // Compact: fill most of the landscape screen with fixed vertical bands so
    // nothing overlaps on a short phone. Slot size is bounded by both the grid
    // band's height (three rows) and its width (columns).
    const margin = Math.min(cw, ch) * 0.03;
    const box = { x: margin, y: margin, w: cw - margin * 2, h: ch - margin * 2 };
    const H = box.h, W = box.w;
    const pad = W * 0.02;
    const gap = pad * 0.5;
    const cols = 4;
    const rows = 3;
    // Vertical bands (fractions of panel height): header / grid / equip / message.
    const gridY = box.y + H * 0.26;          // clears title + subtitle
    const gridBandH = H * 0.40;
    const equipY = gridY + gridBandH + H * 0.05;
    const equipBandH = H * 0.15;
    const msgY = equipY + equipBandH + H * 0.05;
    const journalW = W * 0.30;
    const gridAreaW = W - journalW - pad * 3;
    const slotByW = (gridAreaW - gap * (cols - 1)) / cols;
    const slotByH = (gridBandH - gap * (rows - 1)) / rows;
    const slot = Math.min(slotByW, slotByH);
    const step = slot + gap;
    const gridX = box.x + pad * 1.5;
    const equipSlot = Math.min(slot * 0.9, equipBandH);
    const equipStep = equipSlot + gap;
    const journalX = box.x + W - journalW - pad;
    const journalY = box.y + H * 0.16;
    const journalH = box.y + H - journalY - pad;
    const closeSz = H * 0.13;
    return {
      compact: true,
      ox: box.x, oy: box.y, w: W, h: H,
      cols, slot, step,
      gridX, gridY,
      equipX: gridX, equipY, equipSlot, equipStep,
      journalX, journalY, journalW, journalH,
      close: { x: box.x + W - closeSz - pad, y: box.y + pad * 0.6, w: closeSz, h: closeSz },
      dismantle: { x: gridX + gridAreaW * 0.42, y: equipY, w: gridAreaW * 0.4, h: equipSlot * 0.6 },
      msgX: gridX, msgY, msgW: gridAreaW,
      resultCX: gridX + gridAreaW / 2, resultCY: gridY + gridBandH / 2,
      icon: slot / 24,
      f: {
        title: slot * 0.32, sub: slot * 0.22, label: slot * 0.26,
        body: slot * 0.24, name: slot * 0.2, badge: slot * 0.2,
      },
    };
  }

  // ---------- keyboard / gamepad ----------

  update(input: Input, state: RunState): void {
    const L = this.layout();
    const n = this.materials(state).length;
    if (n > 0) {
      if (input.navRight) { this.cursor = Math.min(n - 1, this.cursor + 1); sfx.play("uiMove"); }
      if (input.navLeft) { this.cursor = Math.max(0, this.cursor - 1); sfx.play("uiMove"); }
      if (input.navDown) { this.cursor = Math.min(n - 1, this.cursor + L.cols); sfx.play("uiMove"); }
      if (input.navUp) { this.cursor = Math.max(0, this.cursor - L.cols); sfx.play("uiMove"); }
      if (input.confirmPressed) this.pickAt(this.cursor, state);
      if (input.justPressed("Backspace", "GpUse") && this.firstPick !== null) {
        this.firstPick = null;
        this.message = "Pick two materials.";
      }
    }
  }

  private pickAt(index: number, state: RunState): void {
    const slots = this.materials(state);
    const pick = slots[index];
    if (!pick) return;
    this.cursor = index;
    if (this.firstPick === null) {
      this.firstPick = index;
      this.message = `${pick.item.name} + ...?`;
      this.messageColor = "#ffd166";
      sfx.play("uiSelect");
    } else {
      const a = slots[this.firstPick]?.item.id;
      const b = pick.item.id;
      this.firstPick = null;
      if (a) this.combine(state, a, b);
    }
  }

  // ---------- pointer (mouse + touch), canvas-pixel space ----------

  private slotIndexAt(x: number, y: number, state: RunState): number | null {
    const L = this.layout();
    const col = Math.floor((x - L.gridX) / L.step);
    const row = Math.floor((y - L.gridY) / L.step);
    const rows = Math.ceil((COLS * 3) / L.cols);
    if (col < 0 || col >= L.cols || row < 0 || row >= rows) return null;
    // Only register a hit if inside the slot square, not the gap.
    if (x > L.gridX + col * L.step + L.slot || y > L.gridY + row * L.step + L.slot) return null;
    const idx = row * L.cols + col;
    return idx < this.materials(state).length ? idx : null;
  }

  private equipIndexAt(x: number, y: number, state: RunState): number | null {
    const L = this.layout();
    if (y < L.equipY || y > L.equipY + L.equipSlot) return null;
    const idx = Math.floor((x - L.equipX) / L.equipStep);
    if (idx < 0 || x > L.equipX + idx * L.equipStep + L.equipSlot) return null;
    return idx < this.equipment(state).length ? idx : null;
  }

  private inRect(x: number, y: number, r: Rect): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  pointerDown(x: number, y: number, state: RunState): void {
    this.downIdx = this.slotIndexAt(x, y, state);
    this.downX = x;
    this.downY = y;
    if (this.downIdx !== null) this.cursor = this.downIdx;
  }

  pointerMove(x: number, y: number): void {
    if (this.downIdx !== null && this.dragIdx === null) {
      const thresh = this.layout().slot * 0.2;
      if (Math.hypot(x - this.downX, y - this.downY) > thresh) {
        this.dragIdx = this.downIdx; // drag begins
        this.firstPick = null;
        sfx.play("uiSelect");
      }
    }
    this.dragX = x;
    this.dragY = y;
  }

  pointerUp(x: number, y: number, state: RunState): "close" | "handled" {
    const L = this.layout();
    if (this.dragIdx === null && this.downIdx === null && this.inRect(x, y, L.close)) {
      return "close";
    }
    const wasDrag = this.dragIdx !== null;
    const dragFrom = this.dragIdx;
    this.dragIdx = null;
    const downWas = this.downIdx;
    this.downIdx = null;

    if (wasDrag && dragFrom !== null) {
      const target = this.slotIndexAt(x, y, state);
      const slots = this.materials(state);
      if (target !== null && target !== dragFrom && slots[dragFrom] && slots[target]) {
        this.onPointerOp?.({ op: "combine", a: slots[dragFrom].item.id, b: slots[target].item.id });
        this.combine(state, slots[dragFrom].item.id, slots[target].item.id);
      } else if (target === dragFrom && slots[dragFrom]) {
        this.onPointerOp?.({ op: "combine", a: slots[dragFrom].item.id, b: slots[dragFrom].item.id });
        this.combine(state, slots[dragFrom].item.id, slots[dragFrom].item.id);
      }
      return "handled";
    }

    // A click/tap (no drag)
    if (downWas !== null) {
      this.onPointerOp?.({ op: "pick", i: downWas });
      this.pickAt(downWas, state);
      return "handled";
    }
    const eq = this.equipIndexAt(x, y, state);
    if (eq !== null) {
      const slot = this.equipment(state)[eq];
      this.onPointerOp?.({ op: "selequip", id: slot.item.id });
      this.applySelectEquip(slot.item.id, state);
      return "handled";
    }
    if (this.selectedEquip && this.inRect(x, y, L.dismantle)) {
      this.onPointerOp?.({ op: "dismantle", id: this.selectedEquip });
      this.dismantle(state, this.selectedEquip);
      return "handled";
    }
    // Outside the panel closes
    if (x < L.ox || x > L.ox + L.w || y < L.oy || y > L.oy + L.h) return "close";
    return "handled";
  }

  private applySelectEquip(id: string, _state: RunState): void {
    const item = this.content.items.find((i) => i.id === id);
    if (!item) return;
    this.selectedEquip = id;
    this.message = `${item.name}: ${item.description}`;
    this.messageColor = "#bbb3d6";
    sfx.play("uiSelect");
  }

  /** Replay: re-apply a recorded pointer-originated craft action. Keyboard
   *  craft actions replay through key injection, so only pointer paths are
   *  recorded semantically (viewport-independent by construction). */
  applyPointerOp(op: CraftPointerOp, state: RunState): void {
    switch (op.op) {
      case "pick": this.pickAt(op.i, state); break;
      case "combine": this.combine(state, op.a, op.b); break;
      case "selequip": this.applySelectEquip(op.id, state); break;
      case "dismantle": this.dismantle(state, op.id); break;
      case "close": break; // handled at the Game level (overlay state)
    }
  }

  // ---------- actions ----------

  /** Break a crafted item back into its ingredients (softlock escape). */
  private dismantle(state: RunState, id: string): void {
    const r = tryDismantle(this.content, state, id);
    if (!r.ok) {
      this.message = "That can't be broken apart — nothing crafted it.";
      this.messageColor = "#e8a2b4";
      this.fxFailAt = performance.now();
      this.fxFailIds = [id];
      sfx.play("craftFail");
      return;
    }
    const names = (r.inputs ?? []).map(
      (i) => this.content.items.find((x) => x.id === i)?.name ?? i
    );
    this.message = `Broke the ${r.baseName} back into ${names.join(" + ")}.`;
    this.messageColor = "#9be8b0";
    this.burst(this.layout().resultCX, this.layout().resultCY, "#7fd8e8", 10);
    if (!state.has(id)) this.selectedEquip = null;
    sfx.play("break");
  }

  private combine(state: RunState, a: string, b: string): void {
    if (a === b && state.count(a) < 2) {
      this.message = "You'd need two of those.";
      this.messageColor = "#e8a2b4";
      this.fxFailAt = performance.now();
      this.fxFailIds = [a];
      sfx.play("craftFail");
      return;
    }
    const result = tryCraft(this.content, state, a, b);
    if (result.ok && result.outputId) {
      const out = this.content.items.find((i) => i.id === result.outputId) ?? null;
      const L = this.layout();
      this.fxSuccessAt = performance.now();
      this.fxResult = out;
      this.burst(L.resultCX, L.resultCY, "#ffe08a", 18);
      this.cursor = 0;
      if (result.discovered && result.recipe) {
        this.newRecipeIds.add(result.recipe.id);
        this.fxBannerAt = performance.now();
        this.fxBannerText = `NEW RECIPE!  ${out?.name ?? result.outputId}`;
        this.message = `Discovered: ${out?.name ?? result.outputId}! ${result.recipe?.flavor ?? ""}`;
        this.messageColor = "#ffd166";
      } else {
        this.message = `${out?.name ?? result.outputId}! ${result.recipe?.flavor ?? ""}`;
        this.messageColor = "#9be8b0";
      }
    } else {
      const an = this.content.items.find((i) => i.id === a)?.name ?? a;
      const bn = this.content.items.find((i) => i.id === b)?.name ?? b;
      this.fxFailAt = performance.now();
      this.fxFailIds = [a, b];
      this.message = `${an} + ${bn} = ... nothing. Noted.`;
      this.messageColor = "#e8a2b4";
    }
    this.onResult(result, a, b);
  }

  // ---------- fx helpers ----------

  private burst(x: number, y: number, color: string, n: number): void {
    const speed = this.layout().slot * 3.2;
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const sp = speed * (0.5 + Math.random() * 0.6);
      this.sparks.push({
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - speed * 0.2,
        life: 0.55 + Math.random() * 0.25, max: 0.8, color,
      });
    }
  }

  private stepSparks(dt: number): void {
    const g = this.layout().slot * 6;
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += g * dt;
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  /** Slot shake offset in px if this item id is currently "wrong". */
  private shakeX(id: string): number {
    if (this.fxFailAt < 0 || !this.fxFailIds.includes(id)) return 0;
    const t = (this.now - this.fxFailAt) / 1000;
    if (t > 0.4) return 0;
    return Math.sin(t * 46) * this.layout().slot * 0.16 * (1 - t / 0.4);
  }

  // ---------- drawing ----------

  draw(ctx: CanvasRenderingContext2D, state: RunState, canvasW: number, canvasH: number): void {
    if (!this.open) return;
    this.now = performance.now();
    const dt = this.lastDraw ? Math.min(0.05, (this.now - this.lastDraw) / 1000) : 0;
    this.lastDraw = this.now;
    this.stepSparks(dt);

    const L = this.layout();

    // Dim the whole canvas (including the letterbox margins).
    ctx.fillStyle = "rgba(8,6,14,0.82)";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Panel
    ctx.fillStyle = "#1c1828";
    roundRect(ctx, L.ox, L.oy, L.w, L.h, L.slot * 0.24);
    ctx.fill();
    ctx.strokeStyle = "#3a3550";
    ctx.lineWidth = Math.max(1, L.icon);
    ctx.stroke();

    const pad = L.slot * 0.4;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#e8e2f4";
    ctx.font = `bold ${L.f.title}px monospace`;
    ctx.fillText("WORKBENCH OF QUESTIONABLE SCIENCE", L.ox + pad, L.oy + pad + L.f.title);
    ctx.font = `${L.f.sub}px monospace`;
    ctx.fillStyle = "#8f87ad";
    ctx.fillText(
      "drag one material onto another · or pick two · tab/esc closes",
      L.ox + pad, L.oy + pad + L.f.title + L.f.sub + 4
    );

    // Close button
    ctx.fillStyle = "#3a3345";
    roundRect(ctx, L.close.x, L.close.y, L.close.w, L.close.h, L.close.w * 0.25);
    ctx.fill();
    ctx.fillStyle = "#e8a2b4";
    ctx.font = `bold ${L.close.h * 0.6}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✕", L.close.x + L.close.w / 2, L.close.y + L.close.h / 2 + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    this.drawMaterials(ctx, state, L);
    this.drawEquipment(ctx, state, L);
    this.drawMessage(ctx, L);
    this.drawJournal(ctx, state, L);
    this.drawSuccessPop(ctx, L);
    this.drawSparks(ctx);
    this.drawBanner(ctx, L);
    this.drawDragGhost(ctx, state, L);
  }

  private drawMaterials(ctx: CanvasRenderingContext2D, state: RunState, L: Layout): void {
    const mats = this.materials(state);
    const combining = this.firstPick !== null || this.dragIdx !== null;
    ctx.fillStyle = "#ffd166";
    ctx.font = `bold ${L.f.label}px monospace`;
    ctx.fillText("MATERIALS", L.gridX, L.gridY - L.f.label * 0.6);

    const total = COLS * 3;
    for (let i = 0; i < total; i++) {
      const col = i % L.cols;
      const row = Math.floor(i / L.cols);
      const slot = mats[i];
      const sx = L.gridX + col * L.step + (slot ? this.shakeX(slot.item.id) : 0);
      const sy = L.gridY + row * L.step;
      const isCursor = i === this.cursor && mats.length > 0;
      const isPicked = i === this.firstPick;
      const isDragging = i === this.dragIdx;
      // A valid combine target while you're mid-pick / mid-drag.
      const isTarget = combining && slot != null && !isPicked && !isDragging;

      ctx.fillStyle = isPicked ? "#3d3556" : "#252134";
      roundRect(ctx, sx, sy, L.slot, L.slot, L.slot * 0.15);
      ctx.fill();

      // Filled material slots read as raised/grabbable; empty ones stay inset.
      if (slot) {
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.lineWidth = Math.max(1, L.icon);
        ctx.strokeRect(sx + 1, sy + 1, L.slot - 2, L.slot * 0.35);
      }
      if (isTarget) {
        const pulse = 0.4 + 0.3 * Math.sin(this.now / 180);
        ctx.strokeStyle = `rgba(127,216,232,${pulse})`;
        ctx.lineWidth = Math.max(1.5, L.icon * 1.5);
        roundRect(ctx, sx, sy, L.slot, L.slot, L.slot * 0.15);
        ctx.stroke();
      }
      if (isPicked) {
        const pulse = 0.55 + 0.35 * Math.sin(this.now / 120);
        ctx.strokeStyle = `rgba(255,209,102,${pulse})`;
        ctx.lineWidth = Math.max(2, L.icon * 2);
        roundRect(ctx, sx, sy, L.slot, L.slot, L.slot * 0.15);
        ctx.stroke();
      } else if (isCursor) {
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = Math.max(1.5, L.icon * 1.5);
        roundRect(ctx, sx, sy, L.slot, L.slot, L.slot * 0.15);
        ctx.stroke();
      }

      if (slot && !isDragging) {
        drawItemIcon(ctx, slot.item, sx + L.slot / 2, sy + L.slot * 0.42, L.icon * 1.4);
        ctx.fillStyle = "#cfc8e6";
        ctx.font = `${L.f.name}px monospace`;
        const maxChars = Math.max(5, Math.floor(L.slot / (L.f.name * 0.62)));
        const name = slot.item.name.length > maxChars
          ? slot.item.name.slice(0, maxChars - 1) + "…" : slot.item.name;
        ctx.fillText(name, sx + L.slot * 0.08, sy + L.slot - L.slot * 0.1);
        if (slot.count > 1) {
          ctx.fillStyle = "#ffd166";
          ctx.font = `bold ${L.f.name * 1.1}px monospace`;
          const badge = "x" + slot.count;
          ctx.fillText(badge, sx + L.slot - ctx.measureText(badge).width - L.slot * 0.08, sy + L.f.name * 1.3);
        }
      }
    }
  }

  private drawEquipment(ctx: CanvasRenderingContext2D, state: RunState, L: Layout): void {
    const equip = this.equipment(state);
    ctx.fillStyle = "#7fd8e8";
    ctx.font = `bold ${L.f.label}px monospace`;
    ctx.fillText("EQUIPMENT (tap one to inspect)", L.equipX, L.equipY - L.f.label * 0.6);
    if (equip.length === 0) {
      ctx.fillStyle = "#5a5470";
      ctx.font = `${L.f.body}px monospace`;
      ctx.fillText("(nothing yet — combine materials above)", L.equipX, L.equipY + L.equipSlot * 0.6);
    }
    if (this.selectedEquip && !equip.some((s) => s.item.id === this.selectedEquip)) {
      this.selectedEquip = null; // got used up / transformed
    }
    equip.forEach((slot, i) => {
      const sx = L.equipX + i * L.equipStep + this.shakeX(slot.item.id);
      const selected = slot.item.id === this.selectedEquip;
      ctx.fillStyle = selected ? "#31517a" : "#20304a";
      roundRect(ctx, sx, L.equipY, L.equipSlot, L.equipSlot, L.equipSlot * 0.16);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#7fd8e8";
        ctx.lineWidth = Math.max(1.5, L.icon * 1.5);
        roundRect(ctx, sx, L.equipY, L.equipSlot, L.equipSlot, L.equipSlot * 0.16);
        ctx.stroke();
      }
      drawItemIcon(ctx, slot.item, sx + L.equipSlot / 2, L.equipY + L.equipSlot / 2, L.icon * 1.3);
      if (slot.count > 1) {
        ctx.fillStyle = "#ffd166";
        ctx.font = `bold ${L.f.name}px monospace`;
        ctx.fillText("x" + slot.count, sx + L.equipSlot * 0.5, L.equipY + L.equipSlot - L.equipSlot * 0.1);
      }
    });
    // "Break apart" — undo a craft to reclaim its ingredients
    if (this.selectedEquip) {
      const d = L.dismantle;
      ctx.fillStyle = "#4a2432";
      roundRect(ctx, d.x, d.y, d.w, d.h, d.h * 0.25);
      ctx.fill();
      ctx.strokeStyle = "#7a3e50";
      ctx.lineWidth = Math.max(1, L.icon);
      roundRect(ctx, d.x, d.y, d.w, d.h, d.h * 0.25);
      ctx.stroke();
      ctx.fillStyle = "#e8a2b4";
      ctx.font = `bold ${L.f.body}px monospace`;
      ctx.textBaseline = "middle";
      ctx.fillText("⟲ break apart", d.x + d.h * 0.4, d.y + d.h / 2);
      ctx.textBaseline = "alphabetic";
    }
  }

  private drawMessage(ctx: CanvasRenderingContext2D, L: Layout): void {
    ctx.fillStyle = this.messageColor;
    ctx.font = `${L.f.body}px monospace`;
    wrapText(ctx, this.message, L.msgX, L.msgY, L.msgW, L.f.body * 1.25);
  }

  private drawJournal(ctx: CanvasRenderingContext2D, state: RunState, L: Layout): void {
    ctx.fillStyle = "#252134";
    roundRect(ctx, L.journalX, L.journalY, L.journalW, L.journalH, L.slot * 0.18);
    ctx.fill();
    const jpad = L.journalW * 0.06;
    ctx.fillStyle = "#e8e2f4";
    ctx.font = `bold ${L.f.body}px monospace`;
    ctx.fillText("JOURNAL", L.journalX + jpad, L.journalY + L.f.body * 1.6);

    const known = this.content.recipes.filter((r) => state.knownRecipes.has(r.id));
    if (known.length === 0) {
      ctx.fillStyle = "#8f87ad";
      ctx.font = `${L.f.sub}px monospace`;
      ctx.fillText("No recipes yet.", L.journalX + jpad, L.journalY + L.f.body * 3);
      ctx.fillText("Find notes. Or guess.", L.journalX + jpad, L.journalY + L.f.body * 4.1);
      return;
    }
    const find = (id: string) => this.content.items.find((i) => i.id === id);
    const rowH = L.slot * 0.62;
    let y = L.journalY + L.f.body * 2.6;
    for (const r of known) {
      const [aId, bId] = [...r.inputs];
      const a = find(aId), b = find(bId), out = find(r.output);
      const crafted = state.craftedRecipes.has(r.id);
      const isNew = this.newRecipeIds.has(r.id);
      const ix = L.journalX + jpad + L.slot * 0.2;
      const cy = y + rowH * 0.3;
      if (isNew) {
        const glow = 0.25 + 0.2 * Math.sin(this.now / 160);
        ctx.fillStyle = `rgba(255,209,102,${glow})`;
        roundRect(ctx, L.journalX + jpad * 0.4, y - rowH * 0.2, L.journalW - jpad * 0.8, rowH, rowH * 0.2);
        ctx.fill();
      }
      const isc = L.icon * 0.85;
      if (a) drawItemIcon(ctx, a, ix, cy, isc);
      ctx.fillStyle = "#8f87ad";
      ctx.font = `${L.f.sub}px monospace`;
      ctx.textBaseline = "middle";
      ctx.fillText("+", ix + L.slot * 0.28, cy);
      if (b) drawItemIcon(ctx, b, ix + L.slot * 0.56, cy, isc);
      ctx.fillText("=", ix + L.slot * 0.84, cy);
      if (out) drawItemIcon(ctx, out, ix + L.slot * 1.12, cy, L.icon * 0.95);
      ctx.fillStyle = isNew ? "#ffd166" : crafted ? "#9be8b0" : "#cfc8e6";
      ctx.font = `${L.f.name}px monospace`;
      const label = (isNew ? "★ " : "") + (out?.name ?? r.output);
      ctx.fillText(label, ix + L.slot * 1.4, cy);
      ctx.textBaseline = "alphabetic";
      y += rowH;
      if (y > L.journalY + L.journalH - rowH * 0.6) break;
    }
  }

  private drawSuccessPop(ctx: CanvasRenderingContext2D, L: Layout): void {
    if (this.fxSuccessAt < 0 || !this.fxResult) return;
    const t = (this.now - this.fxSuccessAt) / 1000;
    const dur = 0.7;
    if (t > dur) return;
    const p = t / dur;
    // Expanding flash ring
    const ring = easeOutCubic(p);
    ctx.strokeStyle = `rgba(255,224,138,${(1 - p) * 0.8})`;
    ctx.lineWidth = Math.max(1.5, L.icon * 2) * (1 - p);
    ctx.beginPath();
    ctx.arc(L.resultCX, L.resultCY, L.slot * (0.4 + ring * 1.6), 0, Math.PI * 2);
    ctx.stroke();
    // Scale-bounce icon
    const scale = p < 0.6 ? easeOutBack(p / 0.6) : 1;
    const alpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
    ctx.globalAlpha = alpha;
    drawItemIcon(ctx, this.fxResult, L.resultCX, L.resultCY, L.icon * 2.4 * scale);
    ctx.globalAlpha = 1;
  }

  private drawSparks(ctx: CanvasRenderingContext2D): void {
    for (const s of this.sparks) {
      ctx.globalAlpha = Math.max(0, s.life / s.max);
      ctx.fillStyle = s.color;
      const r = Math.max(1, this.layout().slot * 0.06);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawBanner(ctx: CanvasRenderingContext2D, L: Layout): void {
    if (this.fxBannerAt < 0) return;
    const t = (this.now - this.fxBannerAt) / 1000;
    const dur = 2.6;
    if (t > dur) return;
    const rise = t < 0.3 ? easeOutCubic(t / 0.3) : 1;
    const fade = t > dur - 0.5 ? (dur - t) / 0.5 : 1;
    const bw = L.w * 0.7;
    const bh = L.slot * 0.9;
    const bx = L.ox + (L.w - bw) / 2;
    const by = L.oy + L.h * 0.3 - (1 - rise) * L.slot;
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#2a2140";
    roundRect(ctx, bx, by, bw, bh, bh * 0.3);
    ctx.fill();
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = Math.max(1.5, L.icon * 1.5);
    roundRect(ctx, bx, by, bw, bh, bh * 0.3);
    ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.font = `bold ${L.f.title}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.fxBannerText, bx + bw / 2, by + bh / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  }

  private drawDragGhost(ctx: CanvasRenderingContext2D, state: RunState, L: Layout): void {
    if (this.dragIdx === null) return;
    const slot = this.materials(state)[this.dragIdx];
    if (!slot) return;
    ctx.globalAlpha = 0.9;
    drawItemIcon(ctx, slot.item, this.dragX, this.dragY - L.slot * 0.2, L.icon * 1.7);
    ctx.globalAlpha = 1;
  }
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number, maxW: number, lineH: number
): number {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
  return yy + lineH;
}
