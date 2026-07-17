// The crafting overlay: drag any material onto another (or two-click / two-pick)
// to combine. Materials are separated from equipment; the journal shows recipes
// as icons. Keyboard, gamepad, mouse, and touch all work.
import type { Content, ItemDef } from "../data/types";
import type { Input } from "../engine/input";
import { drawItemIcon, roundRect } from "../engine/renderer";
import { sfx } from "../engine/audio";
import type { RunState } from "./state";
import { tryCraft, tryDismantle, type CraftResult } from "./crafting";

const COLS = 5;
const SLOT = 34;
const STEP = SLOT + 4;
const PANEL_W = 560;
const PANEL_H = 308;
const PX = (640 - PANEL_W) / 2;
const PY = (360 - PANEL_H) / 2;
const GRID_X = PX + 14;
const GRID_Y = PY + 56;
const EQUIP_Y = GRID_Y + 3 * STEP + 20;
const MSG_Y = EQUIP_Y + 62; // below the shelf and the break-apart button
const JOURNAL_X = PX + PANEL_W - 190;
const CLOSE_BTN = { x: PX + PANEL_W - 28, y: PY + 8, w: 20, h: 20 };
const DISMANTLE_BTN = { x: GRID_X, y: EQUIP_Y + 34, w: 108, h: 18 };

interface Slot {
  item: ItemDef;
  count: number;
}

export class CraftUI {
  open = false;
  private cursor = 0;
  private firstPick: number | null = null;
  private message = "";
  private messageColor = "#bbb3d6";
  private resultItem: ItemDef | null = null;
  private selectedEquip: string | null = null; // item id picked on the shelf
  // Pointer drag state
  private downIdx: number | null = null;
  private downX = 0;
  private downY = 0;
  private dragIdx: number | null = null;
  private dragX = 0;
  private dragY = 0;

  constructor(
    private content: Content,
    private onResult: (r: CraftResult, a: string, b: string) => void
  ) {}

  setContent(content: Content): void {
    this.content = content;
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
    this.resultItem = null;
    this.selectedEquip = null;
  }

  hide(): void {
    this.open = false;
  }

  // ---------- keyboard / gamepad ----------

  update(input: Input, state: RunState): void {
    const n = this.materials(state).length;
    if (n > 0) {
      if (input.navRight) { this.cursor = Math.min(n - 1, this.cursor + 1); sfx.play("uiMove"); }
      if (input.navLeft) { this.cursor = Math.max(0, this.cursor - 1); sfx.play("uiMove"); }
      if (input.navDown) { this.cursor = Math.min(n - 1, this.cursor + COLS); sfx.play("uiMove"); }
      if (input.navUp) { this.cursor = Math.max(0, this.cursor - COLS); sfx.play("uiMove"); }
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
      this.messageColor = "#bbb3d6";
      this.resultItem = null;
      sfx.play("uiSelect");
    } else {
      const a = slots[this.firstPick]?.item.id;
      const b = pick.item.id;
      this.firstPick = null;
      if (a) this.combine(state, a, b);
    }
  }

  // ---------- pointer (mouse + touch) ----------

  private slotIndexAt(x: number, y: number, state: RunState): number | null {
    const col = Math.floor((x - GRID_X) / STEP);
    const row = Math.floor((y - GRID_Y) / STEP);
    if (col < 0 || col >= COLS || row < 0 || row > 2) return null;
    const idx = row * COLS + col;
    return idx < this.materials(state).length ? idx : null;
  }

  private equipIndexAt(x: number, y: number, state: RunState): number | null {
    if (y < EQUIP_Y || y > EQUIP_Y + 30) return null;
    const idx = Math.floor((x - GRID_X) / 34);
    return idx >= 0 && idx < this.equipment(state).length ? idx : null;
  }

  pointerDown(x: number, y: number, state: RunState): void {
    this.downIdx = this.slotIndexAt(x, y, state);
    this.downX = x;
    this.downY = y;
    if (this.downIdx !== null) this.cursor = this.downIdx;
  }

  pointerMove(x: number, y: number): void {
    if (this.downIdx !== null && this.dragIdx === null) {
      if (Math.hypot(x - this.downX, y - this.downY) > 6) {
        this.dragIdx = this.downIdx; // drag begins
        this.firstPick = null;
        sfx.play("uiSelect");
      }
    }
    this.dragX = x;
    this.dragY = y;
  }

  pointerUp(x: number, y: number, state: RunState): "close" | "handled" {
    if (
      this.dragIdx === null && this.downIdx === null &&
      x >= CLOSE_BTN.x && x <= CLOSE_BTN.x + CLOSE_BTN.w &&
      y >= CLOSE_BTN.y && y <= CLOSE_BTN.y + CLOSE_BTN.h
    ) {
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
      if (target !== null && target !== dragFrom) {
        this.combine(state, slots[dragFrom].item.id, slots[target].item.id);
      } else if (target === dragFrom && slots[dragFrom]) {
        // dropped on itself: combine with itself if there are two
        this.combine(state, slots[dragFrom].item.id, slots[dragFrom].item.id);
      }
      return "handled";
    }

    // A click/tap (no drag)
    if (downWas !== null) {
      this.pickAt(downWas, state);
      return "handled";
    }
    const eq = this.equipIndexAt(x, y, state);
    if (eq !== null) {
      const slot = this.equipment(state)[eq];
      this.selectedEquip = slot.item.id;
      this.message = `${slot.item.name}: ${slot.item.description}`;
      this.messageColor = "#bbb3d6";
      this.resultItem = null;
      return "handled";
    }
    // "Break apart" button (visible when an equipment item is selected)
    if (
      this.selectedEquip &&
      x >= DISMANTLE_BTN.x && x <= DISMANTLE_BTN.x + DISMANTLE_BTN.w &&
      y >= DISMANTLE_BTN.y && y <= DISMANTLE_BTN.y + DISMANTLE_BTN.h
    ) {
      this.dismantle(state, this.selectedEquip);
      return "handled";
    }
    // Outside the panel closes
    if (x < PX || x > PX + PANEL_W || y < PY || y > PY + PANEL_H) return "close";
    return "handled";
  }

  /** Break a crafted item back into its ingredients (softlock escape). */
  private dismantle(state: RunState, id: string): void {
    const r = tryDismantle(this.content, state, id);
    if (!r.ok) {
      this.message = "That can't be broken apart — nothing crafted it.";
      this.messageColor = "#e8a2b4";
      sfx.play("craftFail");
      return;
    }
    const names = (r.inputs ?? []).map(
      (i) => this.content.items.find((x) => x.id === i)?.name ?? i
    );
    this.message = `Broke the ${r.baseName} back into ${names.join(" + ")}.`;
    this.messageColor = "#9be8b0";
    this.resultItem = null;
    if (!state.has(id)) this.selectedEquip = null;
    sfx.play("break");
  }

  // ---------- combining ----------

  private combine(state: RunState, a: string, b: string): void {
    if (a === b && state.count(a) < 2) {
      this.message = "You'd need two of those.";
      this.messageColor = "#e8a2b4";
      sfx.play("craftFail");
      return;
    }
    const result = tryCraft(this.content, state, a, b);
    if (result.ok && result.outputId) {
      const out = this.content.items.find((i) => i.id === result.outputId) ?? null;
      this.resultItem = out;
      this.message = `${out?.name ?? result.outputId}! ${result.recipe?.flavor ?? ""}`;
      this.messageColor = "#9be8b0";
      this.cursor = 0;
    } else {
      const an = this.content.items.find((i) => i.id === a)?.name ?? a;
      const bn = this.content.items.find((i) => i.id === b)?.name ?? b;
      this.resultItem = null;
      this.message = `${an} + ${bn} = ... nothing. Noted.`;
      this.messageColor = "#e8a2b4";
    }
    this.onResult(result, a, b);
  }

  // ---------- drawing ----------

  draw(ctx: CanvasRenderingContext2D, state: RunState, viewW: number, viewH: number): void {
    if (!this.open) return;
    ctx.fillStyle = "rgba(8,6,14,0.82)";
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.fillStyle = "#1c1828";
    roundRect(ctx, PX, PY, PANEL_W, PANEL_H, 8);
    ctx.fill();
    ctx.strokeStyle = "#3a3550";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#e8e2f4";
    ctx.font = "bold 12px monospace";
    ctx.fillText("WORKBENCH OF QUESTIONABLE SCIENCE", PX + 14, PY + 20);
    ctx.font = "9px monospace";
    ctx.fillStyle = "#8f87ad";
    ctx.fillText("drag one material onto another · or pick two · tab/esc closes", PX + 14, PY + 33);

    ctx.fillStyle = "#3a3345";
    roundRect(ctx, CLOSE_BTN.x, CLOSE_BTN.y, CLOSE_BTN.w, CLOSE_BTN.h, 4);
    ctx.fill();
    ctx.fillStyle = "#e8a2b4";
    ctx.font = "bold 11px monospace";
    ctx.fillText("✕", CLOSE_BTN.x + 6, CLOSE_BTN.y + 14);

    // Materials
    const mats = this.materials(state);
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 9px monospace";
    ctx.fillText("MATERIALS", GRID_X, GRID_Y - 6);
    for (let i = 0; i < COLS * 3; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const sx = GRID_X + col * STEP;
      const sy = GRID_Y + row * STEP;
      const slot = mats[i];
      const isCursor = i === this.cursor && mats.length > 0;
      const isPicked = i === this.firstPick;
      const isDragging = i === this.dragIdx;
      ctx.fillStyle = isPicked ? "#3d3556" : "#252134";
      roundRect(ctx, sx, sy, SLOT, SLOT, 5);
      ctx.fill();
      if (isCursor) {
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (slot && !isDragging) {
        drawItemIcon(ctx, slot.item, sx + SLOT / 2, sy + SLOT / 2 - 3, 1.4);
        ctx.fillStyle = "#cfc8e6";
        ctx.font = "8px monospace";
        const name = slot.item.name.length > 8 ? slot.item.name.slice(0, 7) + "…" : slot.item.name;
        ctx.fillText(name, sx + 2, sy + SLOT - 3);
        if (slot.count > 1) {
          ctx.fillStyle = "#ffd166";
          ctx.font = "bold 9px monospace";
          ctx.fillText("x" + slot.count, sx + SLOT - 15, sy + 10);
        }
      }
    }

    // Equipment shelf
    const equip = this.equipment(state);
    ctx.fillStyle = "#7fd8e8";
    ctx.font = "bold 9px monospace";
    ctx.fillText("EQUIPMENT (tap one to inspect)", GRID_X, EQUIP_Y - 5);
    if (equip.length === 0) {
      ctx.fillStyle = "#5a5470";
      ctx.font = "9px monospace";
      ctx.fillText("(nothing yet — combine materials above)", GRID_X, EQUIP_Y + 18);
    }
    if (this.selectedEquip && !equip.some((s) => s.item.id === this.selectedEquip)) {
      this.selectedEquip = null; // it got used up / transformed
    }
    equip.forEach((slot, i) => {
      const sx = GRID_X + i * 34;
      const selected = slot.item.id === this.selectedEquip;
      ctx.fillStyle = selected ? "#31517a" : "#20304a";
      roundRect(ctx, sx, EQUIP_Y, 30, 30, 5);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#7fd8e8";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      drawItemIcon(ctx, slot.item, sx + 15, EQUIP_Y + 15, 1.3);
      if (slot.count > 1) {
        ctx.fillStyle = "#ffd166";
        ctx.font = "bold 8px monospace";
        ctx.fillText("x" + slot.count, sx + 16, EQUIP_Y + 28);
      }
    });
    // "Break apart" — undo a craft to reclaim its ingredients
    if (this.selectedEquip) {
      ctx.fillStyle = "#4a2432";
      roundRect(ctx, DISMANTLE_BTN.x, DISMANTLE_BTN.y, DISMANTLE_BTN.w, DISMANTLE_BTN.h, 4);
      ctx.fill();
      ctx.strokeStyle = "#7a3e50";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#e8a2b4";
      ctx.font = "bold 9px monospace";
      ctx.fillText("⟲ break apart", DISMANTLE_BTN.x + 10, DISMANTLE_BTN.y + 13);
    }

    // Message + result
    if (this.resultItem) {
      drawItemIcon(ctx, this.resultItem, GRID_X + 10, MSG_Y - 4, 1.6);
    }
    ctx.fillStyle = this.messageColor;
    ctx.font = "10px monospace";
    wrapText(ctx, this.message, GRID_X + (this.resultItem ? 26 : 0), MSG_Y, PANEL_W - 220, 12);

    // Journal (icon-based)
    ctx.fillStyle = "#252134";
    roundRect(ctx, JOURNAL_X, PY + 46, 176, PANEL_H - 60, 6);
    ctx.fill();
    ctx.fillStyle = "#e8e2f4";
    ctx.font = "bold 10px monospace";
    ctx.fillText("JOURNAL", JOURNAL_X + 10, PY + 62);
    const known = this.content.recipes.filter((r) => state.knownRecipes.has(r.id));
    if (known.length === 0) {
      ctx.fillStyle = "#8f87ad";
      ctx.font = "9px monospace";
      ctx.fillText("No recipes yet.", JOURNAL_X + 10, PY + 80);
      ctx.fillText("Find notes. Or guess.", JOURNAL_X + 10, PY + 92);
    }
    let y = PY + 84;
    for (const r of known) {
      const find = (id: string) => this.content.items.find((i) => i.id === id);
      const [aId, bId] = [...r.inputs];
      const a = find(aId);
      const b = find(bId);
      const out = find(r.output);
      const crafted = state.craftedRecipes.has(r.id);
      const ix = JOURNAL_X + 18;
      if (a) drawItemIcon(ctx, a, ix, y, 0.9);
      ctx.fillStyle = "#8f87ad";
      ctx.font = "9px monospace";
      ctx.fillText("+", ix + 10, y + 3);
      if (b) drawItemIcon(ctx, b, ix + 22, y, 0.9);
      ctx.fillText("=", ix + 32, y + 3);
      if (out) drawItemIcon(ctx, out, ix + 45, y, 1.0);
      ctx.fillStyle = crafted ? "#9be8b0" : "#cfc8e6";
      ctx.fillText(out?.name ?? r.output, ix + 58, y + 3);
      y += 22;
      if (y > PY + PANEL_H - 26) break;
    }

    // Drag ghost rides the pointer
    if (this.dragIdx !== null) {
      const slot = this.materials(state)[this.dragIdx];
      if (slot) {
        ctx.globalAlpha = 0.85;
        drawItemIcon(ctx, slot.item, this.dragX, this.dragY - 6, 1.6);
        ctx.globalAlpha = 1;
      }
    }
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
