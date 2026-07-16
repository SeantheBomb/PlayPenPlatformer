// Boot: load serialized content, start the game, wire the hidden editor.
// Editor access: Ctrl+Shift+E, or ?editor in the URL.
import { store } from "./data/content";
import { Game } from "./game/game";

async function boot() {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Integer-ish scale the 640x360 canvas to the window.
  const fit = () => {
    const scale = Math.max(
      1,
      Math.min(window.innerWidth / 640, window.innerHeight / 360)
    );
    canvas.style.width = `${640 * scale}px`;
    canvas.style.height = `${360 * scale}px`;
  };
  window.addEventListener("resize", fit);
  fit();

  const content = await store.load();
  const game = new Game(ctx, content);
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
