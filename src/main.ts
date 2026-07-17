// Boot: load serialized content, start the game, wire the hidden editor.
// Editor access: Ctrl+Shift+E, or ?editor in the URL.
import { store } from "./data/content";
import { Game } from "./game/game";

async function boot() {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;

  const content = await store.load();
  const game = new Game(ctx, content);

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

  // ---- Hidden editor ----
  let editorOpen = false;
  let editorModule: typeof import("./editor/editor") | null = null;
  const toggleEditor = async () => {
    if (!editorModule) editorModule = await import("./editor/editor");
    editorOpen = !editorOpen;
    const root = document.getElementById("editor-root")!;
    if (editorOpen) {
      root.style.display = "block";
      editorModule.openEditor(root, store, game);
    } else {
      editorModule.closeEditor(root);
      root.style.display = "none";
      // Content may have changed on disk/overlay; re-apply to the running game.
      game.setContent(store.content);
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

  // ---- Debug handle (used for AI-driven playtesting; harmless to ship) ----
  (window as unknown as Record<string, unknown>).PP = {
    game,
    store,
    give: (id: string, n = 1) => game.state?.add(id, n),
    warp: (roomId: string) => {
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
