// In-game bug/feedback report UI — a DOM overlay (not canvas) so mobile
// keyboards work naturally when typing a description. Submits to the
// Cloudflare Pages Function at /api/report; if that's unreachable
// (Electron, local dev without functions) the report queues in
// localStorage instead of being lost.
import type { Game } from "./game";

export const APP_VERSION = "0.3.0";

const TYPES = [
  { id: "bug", label: "Bug" },
  { id: "stuck", label: "I'm stuck" },
  { id: "feedback", label: "Feedback" },
  { id: "idea", label: "Feature idea" },
];

let styleInjected = false;
const CSS = `
.pp-report { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background:rgba(8,6,14,0.82); font:13px "Segoe UI", system-ui, sans-serif; z-index:1000; }
.pp-report-panel { width:min(92vw, 420px); max-height:90vh; overflow:auto; background:#1c1828;
  border:1px solid #3a3550; border-radius:10px; padding:18px; color:#e8e2f4; }
.pp-report-panel h2 { margin:0 0 10px; font-size:15px; color:#ffd166; }
.pp-report-types { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
.pp-report-types button { flex:1; min-width:70px; padding:7px 4px; border-radius:6px; border:1px solid #3a3550;
  background:#241f36; color:#cfc8e6; font-size:12px; cursor:pointer; }
.pp-report-types button.pp-active { background:#3d3556; border-color:#ffd166; color:#fff; }
.pp-report-panel textarea { width:100%; box-sizing:border-box; min-height:90px; background:#100e1a;
  color:#e8e2f4; border:1px solid #3a3550; border-radius:6px; padding:8px; font:12px monospace; resize:vertical; }
.pp-report-hint { color:#8f87ad; font-size:11px; margin:8px 0; }
.pp-report-actions { display:flex; gap:8px; margin-top:12px; justify-content:flex-end; }
.pp-report-actions button { padding:8px 16px; border-radius:6px; border:1px solid #3a3550; cursor:pointer; font-size:12px; }
.pp-report-cancel { background:#241f36; color:#cfc8e6; }
.pp-report-submit { background:#2c5140; color:#9be8b0; border-color:#3e7a5c; }
.pp-report-submit:disabled { opacity:0.5; cursor:default; }
.pp-report-status { margin-top:8px; font-size:11px; color:#9be8b0; min-height:14px; }
`;

export class ReportUI {
  private root: HTMLDivElement;
  private selectedType = "bug";
  private textarea!: HTMLTextAreaElement;
  private statusEl!: HTMLDivElement;
  private submitBtn!: HTMLButtonElement;

  constructor(private game: Game, private onClose: () => void) {
    if (!styleInjected) {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.append(style);
      styleInjected = true;
    }
    this.root = document.createElement("div");
    this.root.className = "pp-report";
    this.root.style.display = "none";
    this.root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.close();
    });
    document.body.append(this.root);
    this.build();
  }

  private build(): void {
    const panel = document.createElement("div");
    panel.className = "pp-report-panel";
    const h = document.createElement("h2");
    h.textContent = "Report something to Sean";
    panel.append(h);

    const types = document.createElement("div");
    types.className = "pp-report-types";
    for (const t of TYPES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = t.label;
      if (t.id === this.selectedType) btn.classList.add("pp-active");
      btn.onclick = () => {
        this.selectedType = t.id;
        [...types.children].forEach((c) => c.classList.remove("pp-active"));
        btn.classList.add("pp-active");
      };
      types.append(btn);
    }
    panel.append(types);

    this.textarea = document.createElement("textarea");
    this.textarea.placeholder = "What happened? What were you trying to do?";
    panel.append(this.textarea);

    const hint = document.createElement("div");
    hint.className = "pp-report-hint";
    hint.textContent = "A screenshot and your current room/inventory are attached automatically.";
    panel.append(hint);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "pp-report-status";
    panel.append(this.statusEl);

    const actions = document.createElement("div");
    actions.className = "pp-report-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pp-report-cancel";
    cancel.textContent = "Cancel";
    cancel.onclick = () => this.close();
    this.submitBtn = document.createElement("button");
    this.submitBtn.type = "button";
    this.submitBtn.className = "pp-report-submit";
    this.submitBtn.textContent = "Send report";
    this.submitBtn.onclick = () => this.submit();
    actions.append(cancel, this.submitBtn);
    panel.append(actions);

    this.root.append(panel);
  }

  open(): void {
    this.textarea.value = "";
    this.statusEl.textContent = "";
    this.root.style.display = "flex";
    setTimeout(() => this.textarea.focus(), 50);
  }

  close(): void {
    this.root.style.display = "none";
    this.onClose();
  }

  private async submit(): Promise<void> {
    const message = this.textarea.value.trim();
    this.submitBtn.disabled = true;
    this.statusEl.textContent = "Sending...";
    const g = this.game;
    try {
      const canvas = document.getElementById("game") as HTMLCanvasElement;
      const payload = {
        type: this.selectedType,
        message,
        room: g.currentRoomId || null,
        position: g.player ? { x: Math.round(g.player.x), y: Math.round(g.player.y) } : null,
        health: g.state?.health ?? null,
        inventory: g.state ? Object.fromEntries(g.state.inventory) : null,
        recipes: g.state ? [...g.state.knownRecipes] : null,
        achievements: g.state ? [...g.state.earned] : null,
        stats: g.state?.stats ?? null,
        scheme: g.input.scheme,
        appVersion: APP_VERSION,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        screenshot: downscale(canvas, 480),
      };
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("bad response");
      this.statusEl.textContent = "Sent. Thank you!";
      setTimeout(() => this.close(), 900);
    } catch {
      // Offline / Electron / no functions locally — don't lose the report.
      try {
        const key = "playpen.pendingReports";
        const queue = JSON.parse(localStorage.getItem(key) ?? "[]");
        queue.push({ type: this.selectedType, message, room: g.currentRoomId, at: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(queue));
      } catch {
        // localStorage unavailable — nothing more we can do here.
      }
      this.statusEl.textContent = "Couldn't reach the server — saved locally instead.";
      setTimeout(() => this.close(), 1400);
    } finally {
      this.submitBtn.disabled = false;
    }
  }
}

function downscale(canvas: HTMLCanvasElement, maxW: number): string {
  const scale = Math.min(1, maxW / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0, w, h);
  return tmp.toDataURL("image/jpeg", 0.7);
}
