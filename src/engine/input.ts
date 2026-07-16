// Keyboard input with just-pressed edge detection.
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  lastInputAt = performance.now();

  constructor(target: HTMLElement | Window = window) {
    target.addEventListener("keydown", (e) => {
      const ev = e as KeyboardEvent;
      // Keep browser shortcuts working, but stop page scroll keys.
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Tab"].includes(ev.key)) {
        ev.preventDefault();
      }
      if (!this.down.has(ev.code)) this.pressed.add(ev.code);
      this.down.add(ev.code);
      this.lastInputAt = performance.now();
    });
    target.addEventListener("keyup", (e) => {
      this.down.delete((e as KeyboardEvent).code);
    });
    window.addEventListener("blur", () => this.down.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  justPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Call once per frame after update. */
  endFrame(): void {
    this.pressed.clear();
  }

  // Semantic helpers (bindings could move to content later)
  get left() { return this.isDown("ArrowLeft", "KeyA"); }
  get right() { return this.isDown("ArrowRight", "KeyD"); }
  get downHeld() { return this.isDown("ArrowDown", "KeyS"); }
  get jumpDown() { return this.isDown("Space", "KeyW", "ArrowUp"); }
  get jumpPressed() { return this.justPressed("Space", "KeyW", "ArrowUp"); }
  get interactPressed() { return this.justPressed("KeyE"); }
  get craftPressed() { return this.justPressed("Tab"); }
  get usePressed() { return this.justPressed("KeyF"); }
  get cyclePressed() { return this.justPressed("KeyQ"); }
  get pausePressed() { return this.justPressed("Escape"); }
  get confirmPressed() { return this.justPressed("Enter", "Space", "KeyE"); }
}
