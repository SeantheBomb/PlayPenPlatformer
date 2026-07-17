// The combine-two crafting overlay (Tab). Keyboard-driven.
import type { Content, ItemDef } from "../data/types";
import type { Input } from "../engine/input";
import { drawItemIcon, roundRect, shade } from "../engine/renderer";
import { sfx } from "../engine/audio";
import type { RunState } from "./state";
import { tryCraft, type CraftResult } from "./crafting";

const COLS = 7;
const SLOT = 34;

export class CraftUI {
  open = false;
  private cursor = 0;
  private firstPick: number | null = null;
  private message = "";
  private messageColor = "#bbb3d6";
  private resultItem: ItemDef | null = null;

  constructor(
    private content: Content,
    private onResult: (r: CraftResult, a: string, b: string) => void
  ) {}

  setContent(content: Content): void {
    this.content = content;
  }

  private slots(state: RunState): { item: ItemDef; count: number }[] {
    const order: Record<string, number> = { material: 0, consumable: 1, tool: 2, curio: 3 };
    const out: { item: ItemDef; count: number }[] = [];
    for (const [id, count] of state.inventory) {
      if (count <= 0) continue;
      const item = this.content.items.find((i) => i.id === id);
      if (item) out.push({ item, count });
    }
    out.sort((a, b) =>
      (order[a.item.kind] - order[b.item.kind]) ||
      a.item.name.localeCompare(b.item.name)
    );
    return out;
  }

  show(): void {
    this.open = true;
    this.cursor = 0;
    this.firstPick = null;
    this.message = "Pick two things. See what happens.";
    this.messageColor = "#bbb3d6";
    this.resultItem = null;
  }

  hide(): void {
    this.open = false;
  }

  update(input: Input, state: RunState): void {
    const slots = this.slots(state);
    const n = slots.length;
    if (n > 0) {
      if (input.navRight) { this.cursor = Math.min(n - 1, this.cursor + 1); sfx.play("uiMove"); }
      if (input.navLeft) { this.cursor = Math.max(0, this.cursor - 1); sfx.play("uiMove"); }
      if (input.navDown) { this.cursor = Math.min(n - 1, this.cursor + COLS); sfx.play("uiMove"); }
      if (input.navUp) { this.cursor = Math.max(0, this.cursor - COLS); sfx.play("uiMove"); }

      if (input.confirmPressed) this.pickAt(this.cursor, state);
      if (input.justPressed("Backspace", "GpUse") && this.firstPick !== null) {
        this.firstPick = null;
        this.message = "Pick two things.";
      }
    }
  }

  /** Select a slot (keyboard/pad confirm or a direct tap). */
  private pickAt(index: number, state: RunState): void {
    const slots = this.slots(state);
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

  /** Touch: taps pick slots; taps outside the panel close. */
  handleTap(x: number, y: number, state: RunState): "close" | "handled" {
    const panelW = 560;
    const panelH = 308;
    const px = (640 - panelW) / 2;
    const py = (360 - panelH) / 2;
    if (x < px || x > px + panelW || y < py || y > py + panelH) return "close";
    const gridX = px + 14;
    const gridY = py + 46;
    const col = Math.floor((x - gridX) / (SLOT + 4));
    const row = Math.floor((y - gridY) / (SLOT + 4));
    if (col >= 0 && col < COLS && row >= 0 && row >= 0 && y >= gridY) {
      const index = row * COLS + col;
      if (index < this.slots(state).length) this.pickAt(index, state);
    }
    return "handled";
  }

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

  draw(ctx: CanvasRenderingContext2D, state: RunState, viewW: number, viewH: number): void {
    if (!this.open) return;
    ctx.fillStyle = "rgba(8,6,14,0.82)";
    ctx.fillRect(0, 0, viewW, viewH);

    const panelW = 560;
    const panelH = 308;
    const px = (viewW - panelW) / 2;
    const py = (viewH - panelH) / 2;
    ctx.fillStyle = "#1c1828";
    roundRect(ctx, px, py, panelW, panelH, 8);
    ctx.fill();
    ctx.strokeStyle = "#3a3550";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#e8e2f4";
    ctx.font = "bold 12px monospace";
    ctx.fillText("WORKBENCH OF QUESTIONABLE SCIENCE", px + 14, py + 20);
    ctx.font = "9px monospace";
    ctx.fillStyle = "#8f87ad";
    ctx.fillText("arrows: move   enter: pick   backspace: unpick   tab/esc: close", px + 14, py + 33);

    // Inventory grid
    const slots = this.slots(state);
    const gridX = px + 14;
    const gridY = py + 46;
    for (let i = 0; i < Math.max(slots.length, COLS * 3); i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const sx = gridX + col * (SLOT + 4);
      const sy = gridY + row * (SLOT + 4);
      const slot = slots[i];
      const isCursor = i === this.cursor && slots.length > 0;
      const isPicked = i === this.firstPick;
      ctx.fillStyle = isPicked ? "#3d3556" : "#252134";
      roundRect(ctx, sx, sy, SLOT, SLOT, 5);
      ctx.fill();
      if (isCursor) {
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (slot) {
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

    // Message + result
    const msgY = gridY + 3 * (SLOT + 4) + 18;
    if (this.resultItem) {
      drawItemIcon(ctx, this.resultItem, gridX + 10, msgY - 4, 1.6);
    }
    ctx.fillStyle = this.messageColor;
    ctx.font = "10px monospace";
    wrapText(ctx, this.message, gridX + (this.resultItem ? 26 : 0), msgY, panelW - 220, 12);

    // Journal
    const jx = px + panelW - 190;
    ctx.fillStyle = "#252134";
    roundRect(ctx, jx, py + 46, 176, panelH - 60, 6);
    ctx.fill();
    ctx.fillStyle = "#e8e2f4";
    ctx.font = "bold 10px monospace";
    ctx.fillText("JOURNAL", jx + 10, py + 62);
    ctx.font = "9px monospace";
    let y = py + 78;
    const known = this.content.recipes.filter((r) => state.knownRecipes.has(r.id));
    if (known.length === 0) {
      ctx.fillStyle = "#8f87ad";
      ctx.fillText("No recipes yet.", jx + 10, y);
      ctx.fillText("Find notes. Or guess.", jx + 10, y + 12);
    }
    for (const r of known) {
      const names = (ids: string[]) =>
        ids.map((id) => this.content.items.find((i) => i.id === id)?.name ?? id);
      const [a, b] = names([...r.inputs]);
      const out = names([r.output])[0];
      const crafted = state.craftedRecipes.has(r.id);
      ctx.fillStyle = crafted ? "#9be8b0" : "#cfc8e6";
      ctx.fillText(`${a} + ${b}`, jx + 10, y);
      ctx.fillStyle = "#8f87ad";
      ctx.fillText(`  = ${out}`, jx + 10, y + 10);
      y += 24;
      if (y > py + panelH - 24) break;
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
