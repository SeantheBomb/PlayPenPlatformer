// Unified input: keyboard, gamepad (polled), and touch (virtual codes).
// The active control scheme is detected from whatever the player last used.

export type ControlScheme = "keyboard" | "gamepad" | "touch";

const STICK_DEADZONE = 0.35;

// Gamepad button indexes (standard mapping): A=0 B=1 X=2 Y=3 LB=4 RB=5
// Start=9, dpad U=12 D=13 L=14 R=15
const PAD_MAP: [code: string, test: (p: Gamepad) => boolean][] = [
  ["GpLeft", (p) => p.axes[0] < -STICK_DEADZONE || !!p.buttons[14]?.pressed],
  ["GpRight", (p) => p.axes[0] > STICK_DEADZONE || !!p.buttons[15]?.pressed],
  ["GpDown", (p) => p.axes[1] > 0.5 || !!p.buttons[13]?.pressed],
  ["GpUp", (p) => p.axes[1] < -0.5 || !!p.buttons[12]?.pressed],
  ["GpJump", (p) => !!p.buttons[0]?.pressed],      // A
  ["GpUse", (p) => !!p.buttons[1]?.pressed],       // B
  ["GpInteract", (p) => !!p.buttons[2]?.pressed],  // X
  ["GpCraft", (p) => !!p.buttons[3]?.pressed],     // Y
  ["GpCycle", (p) => !!p.buttons[4]?.pressed || !!p.buttons[5]?.pressed], // LB/RB
  ["GpPause", (p) => !!p.buttons[9]?.pressed],     // Start
];

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private virtual = new Set<string>(); // touch + gamepad codes currently held
  lastInputAt = performance.now();
  scheme: ControlScheme = "keyboard";
  gamepadConnected = false;
  onSchemeChange?: (s: ControlScheme) => void;

  constructor(target: HTMLElement | Window = window) {
    target.addEventListener("keydown", (e) => {
      const ev = e as KeyboardEvent;
      // Keep browser shortcuts working, but stop page scroll keys.
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Tab"].includes(ev.key)) {
        ev.preventDefault();
      }
      if (!this.down.has(ev.code)) this.pressed.add(ev.code);
      this.down.add(ev.code);
      this.markActivity("keyboard");
    });
    target.addEventListener("keyup", (e) => {
      this.down.delete((e as KeyboardEvent).code);
    });
    window.addEventListener("blur", () => {
      this.down.clear();
      this.virtual.clear();
    });
    window.addEventListener("gamepadconnected", () => {
      this.gamepadConnected = true;
      this.setScheme("gamepad");
    });
    window.addEventListener("gamepaddisconnected", () => {
      this.gamepadConnected = false;
      for (const c of [...this.virtual]) if (c.startsWith("Gp")) this.virtual.delete(c);
    });
  }

  private setScheme(s: ControlScheme): void {
    if (this.scheme !== s) {
      this.scheme = s;
      this.onSchemeChange?.(s);
    }
  }

  private markActivity(s: ControlScheme): void {
    this.lastInputAt = performance.now();
    this.setScheme(s);
  }

  /** Touch buttons (and tests) push virtual codes through here. */
  setVirtual(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.virtual.has(code)) this.pressed.add(code);
      this.virtual.add(code);
      this.markActivity(code.startsWith("Gp") ? "gamepad" : "touch");
    } else {
      this.virtual.delete(code);
    }
  }

  /** Poll connected gamepads once per frame (call before reading input). */
  pollGamepads(): void {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) { pad = p; break; }
    }
    if (!pad) return;
    for (const [code, test] of PAD_MAP) {
      const isDown = test(pad);
      const was = this.virtual.has(code);
      if (isDown && !was) {
        this.pressed.add(code);
        this.virtual.add(code);
        this.markActivity("gamepad");
      } else if (!isDown && was) {
        this.virtual.delete(code);
      }
    }
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c) || this.virtual.has(c));
  }

  justPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Call once per frame after update. */
  endFrame(): void {
    this.pressed.clear();
  }

  // Semantic helpers
  get left() { return this.isDown("ArrowLeft", "KeyA", "GpLeft", "TouchLeft"); }
  get right() { return this.isDown("ArrowRight", "KeyD", "GpRight", "TouchRight"); }
  get downHeld() { return this.isDown("ArrowDown", "KeyS", "GpDown", "TouchDown"); }
  get jumpDown() { return this.isDown("Space", "KeyW", "ArrowUp", "GpJump", "TouchJump"); }
  get jumpPressed() { return this.justPressed("Space", "KeyW", "ArrowUp", "GpJump", "TouchJump"); }
  get interactPressed() { return this.justPressed("KeyE", "GpInteract", "TouchInteract"); }
  get craftPressed() { return this.justPressed("Tab", "GpCraft", "TouchCraft"); }
  get usePressed() { return this.justPressed("KeyF", "GpUse", "TouchUse"); }
  get cyclePressed() { return this.justPressed("KeyQ", "GpCycle"); }
  get pausePressed() { return this.justPressed("Escape", "GpPause", "TouchPause"); }
  get confirmPressed() {
    return this.justPressed("Enter", "Space", "KeyE", "GpJump", "GpInteract", "TouchConfirm");
  }
  // Craft-UI navigation (keyboard arrows or dpad/stick edges)
  get navLeft() { return this.justPressed("ArrowLeft", "KeyA", "GpLeft"); }
  get navRight() { return this.justPressed("ArrowRight", "KeyD", "GpRight"); }
  get navUp() { return this.justPressed("ArrowUp", "KeyW", "GpUp"); }
  get navDown() { return this.justPressed("ArrowDown", "KeyS", "GpDown"); }

  /** Scheme-appropriate label for a semantic action (for prompts/HUD). */
  label(action: "interact" | "use" | "craft" | "cycle" | "jump" | "start"): string {
    const kb: Record<string, string> = {
      interact: "E", use: "F", craft: "TAB", cycle: "Q", jump: "SPACE", start: "ENTER",
    };
    const gp: Record<string, string> = {
      interact: "X", use: "B", craft: "Y", cycle: "LB/RB", jump: "A", start: "START",
    };
    if (this.scheme === "gamepad") return gp[action];
    return kb[action]; // touch draws its own labeled buttons
  }
}
