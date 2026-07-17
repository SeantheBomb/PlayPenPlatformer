// Lightweight anonymous gameplay telemetry.
// Events batch locally and flush to POST /api/telemetry every ~20s (and on
// page hide via sendBeacon). Fire-and-forget: any network failure is
// swallowed and the batch is dropped — telemetry must never affect play.
// No PII: a random per-session id, event names, room ids, item ids, durations.

interface TelemetryEvent {
  t: string; // event type
  at: number; // ms since session start
  room?: string;
  item?: string;
  ms?: number; // duration for room_complete
  extra?: Record<string, unknown>;
}

const FLUSH_MS = 20_000;
const MAX_BATCH = 200;

// crypto.randomUUID() requires a secure context; Electron's file:// origin
// doesn't reliably qualify, and telemetry must never be able to throw during
// module init (a throw here would break the entire import chain, taking the
// game down with it). Fall back to a plain random id instead.
function safeId(): string {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    // fall through to the manual generator below
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class Telemetry {
  private sessionId = safeId();
  private startedAt = Date.now();
  private queue: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private endpoint = "/api/telemetry";
  enabled = true;

  constructor() {
    try {
      // file:// (Electron dev) posts to the live site; browser posts same-origin.
      if (location.protocol === "file:") {
        this.endpoint = "https://playpen.pages.dev/api/telemetry";
      }
      this.timer = setInterval(() => this.flush(), FLUSH_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.flush(true);
      });
      window.addEventListener("pagehide", () => this.flush(true));
    } catch {
      this.enabled = false;
    }
  }

  event(t: string, fields: Omit<TelemetryEvent, "t" | "at"> = {}): void {
    if (!this.enabled) return;
    try {
      this.queue.push({ t, at: Date.now() - this.startedAt, ...fields });
      if (this.queue.length >= MAX_BATCH) this.flush();
    } catch {
      // Telemetry is best-effort only — never let it interrupt gameplay.
    }
  }

  roomEnter(room: string): void {
    this.event("room_enter", { room });
  }
  roomComplete(room: string, ms: number): void {
    this.event("room_complete", { room, ms: Math.round(ms) });
  }
  death(room: string): void {
    this.event("death", { room });
  }
  craft(room: string, item: string): void {
    this.event("craft", { room, item });
  }
  collect(room: string, item: string): void {
    this.event("collect", { room, item });
  }

  private flush(useBeacon = false): void {
    if (this.queue.length === 0) return;
    const payload = JSON.stringify({
      sessionId: this.sessionId,
      sentAt: new Date().toISOString(),
      events: this.queue,
    });
    this.queue = [];
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(this.endpoint, new Blob([payload], { type: "application/json" }));
      } else {
        void fetch(this.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Telemetry is best-effort only.
    }
  }
}

export const telemetry = new Telemetry();
