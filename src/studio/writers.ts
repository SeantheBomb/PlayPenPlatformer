// PlayPen Writers Studio — the writer-facing home for everything the game
// SAYS. Lives on the same site as the game (?write), gated by its own
// password (WRITER_PASSWORD, separate from the editor's and the artist's),
// and publishes through the server's story-scoped path so it can only ever
// change dialog, quests, taunts, notes and descriptions.
//
// Same UX contract as the Art Studio (src/studio/studio.ts): a non-technical
// writer walks in cold and follows the journey — read a character's whole
// arc, rewrite a line and see it in the real dialog box or banner, play the
// room, publish when happy, always able to undo. The shell (login, publish,
// hand-off into the game, CSS) is shared with the Art Studio via shell.ts.
import type { ContentStore } from "../data/content";
import type { Game } from "../game/game";
import { el } from "../editor/forms";
import { ensureStudioStyles, loginView, publishScoped, tryInGame, type StudioCredential } from "./shell";
import { castView, characterView, buildCast, castHealth } from "./characters";
import { wardenView } from "./warden";
import { hintsView, itemsView, notesView } from "./lore";
import { stopLinePreviews } from "./linepreview";

const PASS_KEY = "playpen.writer.password";
const SEEN_KEY = "playpen.writer.welcomed";
const WRITER: StudioCredential = {
  passKey: PASS_KEY,
  header: "x-writer-password",
  endpoint: "/api/writer",
  title: "✍ PlayPen Writers Studio",
  blurb: "Welcome! This is where every word in PlayPen lives — the cast, the Warden, the notes. Enter the studio password Sean gave you to get started.",
};

/** What every writing surface needs from the studio. */
export interface WriterContext {
  store: ContentStore;
  /** Persist one content file to the draft and mark the draft dirty. */
  save: (rel: string, data: unknown) => Promise<void>;
  /** Re-render the current view (keeps scroll when it's the same page). */
  render: () => void;
  playRoom: (roomId: string) => void;
  openCast: () => void;
  openCharacter: (npcId: string) => void;
}

let active: WritersStudio | null = null;

export function openStudio(root: HTMLElement, store: ContentStore, game: Game): void {
  ensureStudioStyles();
  active = new WritersStudio(root, store, game);
  active.render();
}

export function closeStudio(root: HTMLElement): void {
  active?.dispose();
  root.replaceChildren();
  active = null;
}

type View = "login" | "welcome" | "cast" | "character" | "warden" | "notes" | "hints" | "items";

class WritersStudio {
  private view: View = "cast";
  private npcId: string | null = null;
  private online = true;
  private dirty = false;
  private lastRendered = "";

  constructor(private root: HTMLElement, private store: ContentStore, _game: Game) {
    const pass = localStorage.getItem(PASS_KEY);
    this.view = !pass ? "login" : localStorage.getItem(SEEN_KEY) ? "cast" : "welcome";
  }

  dispose(): void {
    stopLinePreviews();
  }

  private ctx(): WriterContext {
    return {
      store: this.store,
      save: async (rel, data) => { await this.store.saveFile(rel, data); this.dirty = true; },
      render: () => this.render(),
      playRoom: (roomId) => tryInGame(roomId),
      openCast: () => { this.view = "cast"; this.npcId = null; this.render(); },
      openCharacter: (npcId) => { this.view = "character"; this.npcId = npcId; this.render(); },
    };
  }

  render(): void {
    stopLinePreviews();
    // Same page re-rendered (a line saved, a quest changed) keeps her scroll
    // position; navigating somewhere new starts at the top.
    const here = `${this.view}|${this.npcId}`;
    const prevScroll = here === this.lastRendered
      ? (this.root.querySelector(".st-root") as HTMLElement | null)?.scrollTop ?? 0
      : 0;
    this.lastRendered = here;
    this.root.replaceChildren();
    const shell = el("div", { className: "st-root" }, el("div", { className: "st-shell" }));
    const inner = shell.firstChild as HTMLElement;
    this.root.append(shell);
    if (this.view === "login") {
      inner.append(loginView(WRITER, (online) => {
        this.online = online;
        this.view = localStorage.getItem(SEEN_KEY) ? "cast" : "welcome";
        this.render();
      }));
      return;
    }
    inner.append(this.header());
    const ctx = this.ctx();
    switch (this.view) {
      case "welcome": inner.append(this.welcomeView()); break;
      case "character": inner.append(this.npcId ? characterView(ctx, this.npcId) : castView(ctx)); break;
      case "warden": inner.append(wardenView(ctx)); break;
      case "notes": inner.append(notesView(ctx)); break;
      case "hints": inner.append(hintsView(ctx)); break;
      case "items": inner.append(itemsView(ctx)); break;
      default: inner.append(castView(ctx));
    }
    if (prevScroll) shell.scrollTop = prevScroll;
  }

  private header(): HTMLElement {
    const pubInfo = this.store.publishedInfo;
    const nav = (label: string, title: string, views: View[], go: () => void) =>
      el("button", {
        className: `st-btn${views.includes(this.view) ? " st-on" : ""}`, title,
        onclick: () => { go(); this.render(); },
      }, label);
    return el(
      "div", { className: "st-header" },
      el("span", { className: "st-title" }, "✍ Writers Studio"),
      nav("👥 Cast", "Every resident and their whole arc", ["cast", "character"], () => { this.view = "cast"; this.npcId = null; }),
      nav("🎭 Warden", "Every taunt, by what triggers it", ["warden"], () => { this.view = "warden"; }),
      nav("📜 Notes", "The diary scraps", ["notes"], () => { this.view = "notes"; }),
      nav("💡 Hints", "In-world tutorial text", ["hints"], () => { this.view = "hints"; }),
      nav("🎒 Items", "Item and recipe one-liners", ["items"], () => { this.view = "items"; }),
      this.online ? null : el("span", { className: "st-badge" }, "offline — publishing unavailable"),
      el("span", { className: "st-spacer" }),
      el("button", { className: "st-btn st-quiet", onclick: () => { this.view = "welcome"; this.render(); } }, "How it works"),
      el("button", {
        className: "st-btn", title: "Close the studio and play the game with your draft lines",
        onclick: () => tryInGame(),
      }, "🎮 Try in game"),
      el("button", {
        className: "st-btn st-primary",
        title: pubInfo ? `Everyone playing the game gets your words. Last publish: ${pubInfo.publishedAt.slice(0, 16).replace("T", " ")}` : "Everyone playing the game gets your words",
        onclick: () => void this.publish(),
      }, "🚀 Publish writing")
    );
  }

  private welcomeView(): HTMLElement {
    const cast = buildCast(this.store.content);
    const gaps = cast.reduce((n, m) => n + castHealth(m).empty, 0);
    return el("div", {},
      el("div", { className: "st-card" },
        el("h2", { style: "margin:0 0 6px;color:#ffd166" }, "Welcome to the studio 👋"),
        el("p", {},
          `Every word in PlayPen is here — ${cast.length} residents with their dialog and quests, the Warden's every taunt, ` +
          `the diary notes, the hints, and the item one-liners. Right now ${gaps} dialog slot${gaps === 1 ? "" : "s"} ` +
          "are empty and everything else is a working draft, not scripture — improve any line you can beat."),
        el("div", { className: "st-steps" },
          el("div", { className: "st-step" }, el("b", {}, "1 · Read an arc"),
            "Open a character. Every room they appear in is listed in the order the player meets them, each with its own lines — so you can hear one voice across the whole game."),
          el("div", { className: "st-step" }, el("b", {}, "2 · Rewrite & see it"),
            "Type in a box and the real dialog box or Warden banner next to it updates as you go — real portrait, real typewriter, real wrap. Little flags under a line point out anything that breaks the house rules."),
          el("div", { className: "st-step" }, el("b", {}, "3 · Play it"),
            "“Play this room” drops you into that room in the actual game with your draft lines, before anyone else sees them."),
          el("div", { className: "st-step" }, el("b", {}, "4 · Publish"),
            "“Publish writing” ships your words to everyone playing. Publishing only ever changes dialog, quests, and text — never levels, art, or rules — and every publish is saved, so anything can be undone.")),
        el("div", { className: "st-note", style: "margin-top:12px" },
          "The fixed points: the voice rules, the cast identities, the iceberg (the words AI, simulation, program, code, construct, iteration, algorithm, data, server never appear), " +
          "and the ending — they leave as themselves, and that's new. Everything else is yours."),
        el("div", { className: "st-row", style: "margin-top:12px" },
          el("button", {
            className: "st-btn st-primary",
            onclick: () => { localStorage.setItem(SEEN_KEY, "1"); this.view = "cast"; this.render(); },
          }, "Meet the cast →"))));
  }

  private async publish(): Promise<void> {
    const ok = await publishScoped(WRITER, this.store, {
      confirm:
        "Publish your writing to everyone playing PlayPen?\n\n" +
        "Only dialog, quests, and text are ever published from the studio — levels, art, and game rules stay exactly as they are. " +
        "Every publish is kept in history, so this can always be undone.",
      note: "writing update from the studio",
      what: "words",
    });
    if (ok) this.dirty = false;
  }
}
