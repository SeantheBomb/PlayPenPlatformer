// Hidden debug overlay: add any content item straight into inventory.
// Toggled by the backtick key (see main.ts) — for testing, not players.
// Same trust model as the existing PP.give() debug handle: harmless to
// ship, taints the session as bot-driven the same way.
import type { Game } from "./game";
import { recorder } from "./recorder";

let styleInjected = false;
const CSS = `
.pp-debugmenu { position:absolute; inset:0; display:none; align-items:center; justify-content:center;
  background:rgba(8,6,14,0.82); font:13px "Segoe UI", system-ui, sans-serif; z-index:1000; }
.pp-debugmenu-panel { width:min(92vw, 460px); max-height:80vh; display:flex; flex-direction:column;
  background:#1c1828; border:1px solid #3a3550; border-radius:10px; padding:16px; color:#e8e2f4; }
.pp-debugmenu-panel h2 { margin:0 0 10px; font-size:15px; color:#ffd166; }
.pp-debugmenu-panel input[type="text"] { width:100%; box-sizing:border-box; background:#100e1a;
  color:#e8e2f4; border:1px solid #3a3550; border-radius:6px; padding:7px 8px; font:12px monospace;
  margin-bottom:10px; }
.pp-debugmenu-list { overflow-y:auto; flex:1; min-height:0; }
.pp-debugmenu-row { display:flex; align-items:center; gap:8px; padding:5px 2px;
  border-bottom:1px solid #2c2740; }
.pp-debugmenu-row .pp-dm-label { flex:1; font-size:12px; }
.pp-debugmenu-row .pp-dm-label b { color:#e8e2f4; }
.pp-debugmenu-row .pp-dm-label span { color:#8f87ad; }
.pp-debugmenu-row input[type="number"] { width:48px; background:#100e1a; color:#e8e2f4;
  border:1px solid #3a3550; border-radius:4px; padding:3px; font:12px monospace; }
.pp-debugmenu-row button { padding:5px 10px; border-radius:6px; border:1px solid #3e7a5c;
  background:#2c5140; color:#9be8b0; cursor:pointer; font-size:12px; }
.pp-debugmenu-foot { display:flex; justify-content:space-between; align-items:center; margin-top:10px; }
.pp-debugmenu-close { padding:7px 14px; border-radius:6px; border:1px solid #3a3550;
  background:#241f36; color:#cfc8e6; cursor:pointer; font-size:12px; }
`;

export class DebugMenu {
  private root: HTMLDivElement;
  private listEl!: HTMLDivElement;
  private filterEl!: HTMLInputElement;

  constructor(private game: Game, private onClose: () => void) {
    if (!styleInjected) {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.append(style);
      styleInjected = true;
    }
    this.root = document.createElement("div");
    this.root.className = "pp-debugmenu";
    this.root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.close();
    });
    document.body.append(this.root);
    this.build();
  }

  get isOpen(): boolean {
    return this.root.style.display !== "none" && this.root.style.display !== "";
  }

  private build(): void {
    const panel = document.createElement("div");
    panel.className = "pp-debugmenu-panel";

    const h = document.createElement("h2");
    h.textContent = "Debug: Add Item";
    panel.append(h);

    this.filterEl = document.createElement("input");
    this.filterEl.type = "text";
    this.filterEl.placeholder = "filter by name or id...";
    this.filterEl.oninput = () => this.renderList();
    panel.append(this.filterEl);

    this.listEl = document.createElement("div");
    this.listEl.className = "pp-debugmenu-list";
    panel.append(this.listEl);

    const foot = document.createElement("div");
    foot.className = "pp-debugmenu-foot";
    const hint = document.createElement("span");
    hint.style.color = "#8f87ad";
    hint.style.fontSize = "11px";
    hint.textContent = "` or Esc to close";
    const closeBtn = document.createElement("button");
    closeBtn.className = "pp-debugmenu-close";
    closeBtn.textContent = "Close";
    closeBtn.onclick = () => this.close();
    foot.append(hint, closeBtn);
    panel.append(foot);

    this.root.append(panel);
  }

  private renderList(): void {
    const q = this.filterEl.value.trim().toLowerCase();
    this.listEl.replaceChildren();
    for (const item of this.game.content.items) {
      if (q && !item.name.toLowerCase().includes(q) && !item.id.toLowerCase().includes(q)) continue;
      const row = document.createElement("div");
      row.className = "pp-debugmenu-row";

      const label = document.createElement("span");
      label.className = "pp-dm-label";
      label.innerHTML = `<b>${item.name}</b> <span>(${item.id} — ${item.kind})</span>`;
      row.append(label);

      const countInput = document.createElement("input");
      countInput.type = "number";
      countInput.value = "1";
      countInput.min = "1";
      row.append(countInput);

      const addBtn = document.createElement("button");
      addBtn.textContent = "Add";
      addBtn.onclick = () => {
        const n = Math.max(1, Math.floor(Number(countInput.value)) || 1);
        recorder.taint("debug-item-menu");
        this.game.state?.add(item.id, n);
      };
      row.append(addBtn);

      this.listEl.append(row);
    }
  }

  open(): void {
    this.root.style.display = "flex";
    this.filterEl.value = "";
    this.renderList();
    setTimeout(() => this.filterEl.focus(), 50);
  }

  close(): void {
    this.root.style.display = "none";
    this.onClose();
  }
}
