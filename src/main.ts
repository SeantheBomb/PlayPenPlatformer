// Boot: load serialized content, start the game, wire the hidden editor.
// Editor access: Ctrl+Shift+E, or ?editor in the URL.
import { store } from "./data/content";
import { Game } from "./game/game";
import { recorder } from "./game/recorder";
import { startVersionCheck } from "./versioncheck";

async function boot() {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;

  const content = await store.load();
  const game = new Game(ctx, content);

  // ---- Session recording (deterministic input-replay telemetry) ----
  // The recorder snapshots the content actually in play and streams every
  // input transition; sessions surface in the editor's "sessions" tab.
  recorder.contentFiles = () => store.allFiles();
  recorder.apiBase = location.protocol === "file:" ? "https://playpen.pages.dev" : "";
  game.input.onTransition = (code, down, trusted) =>
    recorder.onInputTransition(code, down, trusted);

  // Render at native resolution: the backing store matches the window (x DPR)
  // and the 640x360 logical view is scaled up with a transform, so text and
  // shapes stay crisp at any window size. Art is procedural, so this is free.
  const fit = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const scale = Math.min((w * dpr) / 640, (h * dpr) / 360);
    const ox = (w * dpr - 640 * scale) / 2;
    const oy = (h * dpr - 360 * scale) / 2;
    // "Compact" = phone-sized: the shorter CSS dimension is small. Drives the
    // zoomed-in world view and larger touch targets.
    const compact = Math.min(w, h) < 500;
    game.setViewport(scale, ox, oy, compact);
  };
  window.addEventListener("resize", fit);
  fit();
  game.start();
  canvas.focus();
  startVersionCheck();

  // ---- Hidden editor ----
  let editorOpen = false;
  let editorModule: typeof import("./editor/editor") | null = null;
  const toggleEditor = async () => {
    if (!editorModule) editorModule = await import("./editor/editor");
    editorOpen = !editorOpen;
    const root = document.getElementById("editor-root")!;
    if (editorOpen) {
      // Opening the editor mid-run ends the session cleanly (design
      // iteration, not organic play) and flags this page-load as dev.
      recorder.devFlag = true;
      recorder.end("editor", game);
      game.pause();
      root.style.display = "block";
      editorModule.openEditor(root, store, game);
    } else {
      editorModule.closeEditor(root);
      root.style.display = "none";
      // Content may have changed on disk/overlay; re-apply to the running game.
      game.setContent(store.content);
      game.resume();
      canvas.focus();
    }
  };
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === "KeyE") {
      e.preventDefault();
      toggleEditor();
    }
  });
  if (new URLSearchParams(location.search).has("editor")) toggleEditor();

  // ---- Art Studio (?art) — the artist's home, see src/studio/ ----
  // Unlike the editor there's no hotkey: the artist gets a link, and while
  // she's in art mode a persistent 🎨 button toggles studio <-> game so
  // "try it, tweak it, try again" never needs any keyboard knowledge.
  if (new URLSearchParams(location.search).has("art")) {
    let studioOpen = false;
    let studioModule: typeof import("./studio/studio") | null = null;
    const studioRoot = document.createElement("div");
    studioRoot.id = "studio-root";
    studioRoot.style.cssText = "position:absolute;inset:0;z-index:20;display:none";
    document.body.append(studioRoot);
    const studioBtn = document.createElement("button");
    studioBtn.textContent = "🎨 Back to studio";
    studioBtn.style.cssText =
      "position:fixed;top:10px;right:10px;z-index:30;display:none;" +
      "background:#1c1730;color:#ffd166;border:1px solid #4a4070;border-radius:8px;" +
      "padding:8px 14px;font:14px system-ui;cursor:pointer";
    document.body.append(studioBtn);
    const toggleStudio = async () => {
      if (!studioModule) studioModule = await import("./studio/studio");
      studioOpen = !studioOpen;
      if (studioOpen) {
        recorder.devFlag = true; // artist iteration, not organic play
        game.pause();
        studioRoot.style.display = "block";
        studioBtn.style.display = "none";
        studioModule.openStudio(studioRoot, store, game);
      } else {
        studioModule.closeStudio(studioRoot);
        studioRoot.style.display = "none";
        studioBtn.style.display = "block";
        game.setContent(store.content); // her draft art, live in the game
        game.resume();
        canvas.focus();
      }
    };
    studioBtn.onclick = () => void toggleStudio();
    window.addEventListener("pp-studio-close", () => { if (studioOpen) void toggleStudio(); });
    void toggleStudio();
  }

  // ---- Shareable deep links: ?room=<id> or ?room=<id>&checkpoint=<id> ----
  // Jumps straight into a room (or a specific checkpoint within it),
  // bypassing the main menu and normal campaign order — for handing
  // someone a link straight into a level instead of "click new game, then
  // navigate the level-select". Not organic play, so tainted like
  // PP.warp/PP.give — a demo walkthrough shouldn't count in playtest stats.
  // Web-build only: Electron has no address bar to paste a link into.
  const deepLinkRoom = new URLSearchParams(location.search).get("room");
  if (deepLinkRoom && content.rooms[deepLinkRoom]) {
    recorder.taint("deep-link");
    game.newRun(deepLinkRoom);
    const checkpointId = new URLSearchParams(location.search).get("checkpoint");
    if (checkpointId) {
      const cp = game.roomRt.entities.find(
        (e) => e.kind === "checkpoint" && e.def.id === checkpointId
      );
      if (cp) {
        const x = cp.x + cp.w / 2, y = cp.y + cp.h;
        game.player.placeFeetAt(x, y);
        game.state.checkpoint = { roomId: deepLinkRoom, x, y, loadout: cp.def.loadout };
        game.state.applyLoadout(cp.def.loadout);
      }
    }
  }

  // ---- Debug item menu (` key): add any content item to inventory ----
  let debugMenu: import("./game/debugmenu").DebugMenu | null = null;
  const toggleDebugMenu = async () => {
    if (editorOpen || !game.state) return;
    if (!debugMenu) {
      const mod = await import("./game/debugmenu");
      debugMenu = new mod.DebugMenu(game, () => {
        game.resume();
        canvas.focus();
      });
    }
    if (debugMenu.isOpen) {
      debugMenu.close();
    } else {
      game.pause();
      debugMenu.open();
    }
  };
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Backquote") return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    void toggleDebugMenu();
  });

  // ---- Debug handle (used for AI-driven playtesting; harmless to ship) ----
  (window as unknown as Record<string, unknown>).PP = {
    game,
    store,
    recorder,
    give: (id: string, n = 1) => {
      recorder.taint("debug-give"); // state mutated outside real play = bot session
      return game.state?.add(id, n);
    },
    warp: (roomId: string) => {
      recorder.taint("debug-warp");
      if (game.scene !== "play") game.newRun(roomId);
      else {
        game.loadRoom(roomId);
        game.state.checkpoint = { roomId, x: game.roomRt.spawnX, y: game.roomRt.spawnY };
      }
    },
    state: () => ({
      scene: game.scene,
      overlay: game.overlay,
      room: game.currentRoomId,
      x: game.player?.x,
      y: game.player?.y,
      health: game.state?.health,
      inventory: game.state ? Object.fromEntries(game.state.inventory) : {},
      recipes: game.state ? [...game.state.knownRecipes] : [],
    }),
  };
}

boot();
