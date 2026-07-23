import { screen, type WebContents } from "electron";

type CursorAction = "Left" | "Right" | "Middle" | "Back" | "Forward";
type CursorInput = {
  clientX: number;
  clientY: number;
  windowX: number;
  windowY: number;
} & (
  | { kind: "Enter" | "Leave" | "Move" }
  | { kind: "Scroll"; axis: "X" | "Y"; delta: number }
  | {
      kind: "Action";
      action: CursorAction;
      state: "Pressed" | "Released";
      doubleClick: boolean;
    }
);
type KeyboardInput =
  | {
      kind: "Key";
      key: { code: number; extended: boolean };
      state: "Pressed" | "Released";
    }
  | { kind: "Char"; ch: string }
  | { kind: "Ime"; ime: { kind: string; text?: string } };
type OverlayEvent = {
  on: (name: string, listener: (...args: never[]) => void) => void;
  off: (name: string, listener: (...args: never[]) => void) => void;
};
type InputOverlay = {
  event: OverlayEvent;
  setBlockingCursor: (id: number, cursor?: number) => Promise<void>;
};
type OverlayWindow = { id: number; overlay: InputOverlay };

const cursorByCssName: Record<string, number | undefined> = {
  default: 0,
  pointer: 0,
  crosshair: 6,
  hand: 2,
  text: 7,
  wait: 4,
  help: 1,
  "e-resize": 17,
  "w-resize": 17,
  "ew-resize": 17,
  "n-resize": 18,
  "s-resize": 18,
  "ns-resize": 18,
  "ne-resize": 19,
  "sw-resize": 19,
  "nesw-resize": 19,
  "nw-resize": 20,
  "se-resize": 20,
  "nwse-resize": 20,
  "col-resize": 15,
  "row-resize": 16,
  move: 11,
  "vertical-text": 8,
  cell: 5,
  alias: 9,
  progress: 3,
  nodrop: 12,
  "not-allowed": 12,
  copy: 10,
  none: undefined,
  "zoom-in": 21,
  "zoom-out": 22,
  grab: 13,
  grabbing: 14,
};

const fixedKeys: Record<number, string> = {
  8: "Backspace",
  9: "Tab",
  13: "Enter",
  16: "Shift",
  17: "Control",
  18: "Alt",
  20: "Capslock",
  27: "Escape",
  32: "Space",
  33: "PageUp",
  34: "PageDown",
  35: "End",
  36: "Home",
  37: "Left",
  38: "Up",
  39: "Right",
  40: "Down",
  44: "PrintScreen",
  45: "Insert",
  46: "Delete",
  91: "Super",
  92: "Super",
  93: "Meta",
  106: "nummult",
  107: "numadd",
  109: "numsub",
  110: "numdec",
  111: "numdiv",
  144: "Numlock",
  145: "Scrolllock",
  176: "MediaNextTrack",
  177: "MediaPreviousTrack",
  178: "MediaStop",
  179: "MediaPlayPause",
  181: "VolumeMute",
  182: "VolumeDown",
  183: "VolumeUp",
  186: ";",
  187: "=",
  188: ",",
  189: "-",
  190: ".",
  191: "/",
  192: "`",
  219: "[",
  220: "\\",
  221: "]",
  222: "'",
  225: "AltGr",
};

const mapVirtualKey = (code: number) => {
  if (code >= 48 && code <= 57) return String.fromCharCode(code);
  if (code >= 65 && code <= 90) return String.fromCharCode(code);
  if (code >= 96 && code <= 105) return `num${code - 96}`;
  if (code >= 112 && code <= 135) return `F${code - 111}`;
  return fixedKeys[code];
};

export class HydraOverlayInput {
  private readonly cursorInputHandler: (id: number, input: CursorInput) => void;
  private readonly keyboardInputHandler: (
    id: number,
    input: KeyboardInput
  ) => void;
  private readonly cursorChangedHandler: (
    event: Electron.Event,
    type: string
  ) => void;
  private readonly displayMetricsChangedHandler: () => void;
  private screenScaleFactor = 1;
  private lastWindowCursor = { x: 0, y: 0 };
  private clickCounts: number[] = [];
  private modifierState = {
    shift: false,
    ctrl: false,
    alt: false,
    super: false,
    meta: false,
  };
  private modifiers: Array<"shift" | "ctrl" | "alt" | "meta" | "cmd"> = [];

  private constructor(
    private readonly window: OverlayWindow,
    private readonly contents: WebContents
  ) {
    this.updateScaleFactor();
    this.displayMetricsChangedHandler = () => this.updateScaleFactor();
    this.cursorInputHandler = (id, input) => {
      if (id === this.window.id) this.sendCursorInput(input);
    };
    this.keyboardInputHandler = (id, input) => {
      if (id === this.window.id) this.sendKeyboardInput(input);
    };
    this.cursorChangedHandler = (_event, type) => {
      const cursor = Object.prototype.hasOwnProperty.call(cursorByCssName, type)
        ? cursorByCssName[type]
        : 0;
      void this.window.overlay.setBlockingCursor(this.window.id, cursor);
    };
    screen.on("display-metrics-changed", this.displayMetricsChangedHandler);
    this.window.overlay.event.on(
      "cursor_input",
      this.cursorInputHandler as (...args: never[]) => void
    );
    this.window.overlay.event.on(
      "keyboard_input",
      this.keyboardInputHandler as (...args: never[]) => void
    );
    this.contents.on("cursor-changed", this.cursorChangedHandler);
  }

  public static connect(window: OverlayWindow, contents: WebContents) {
    return new HydraOverlayInput({ ...window }, contents);
  }

  public async disconnect() {
    screen.off("display-metrics-changed", this.displayMetricsChangedHandler);
    this.window.overlay.event.off(
      "cursor_input",
      this.cursorInputHandler as (...args: never[]) => void
    );
    this.window.overlay.event.off(
      "keyboard_input",
      this.keyboardInputHandler as (...args: never[]) => void
    );
    this.contents.off("cursor-changed", this.cursorChangedHandler);
    await this.window.overlay
      .setBlockingCursor(this.window.id, 0)
      .catch(() => undefined);
  }

  private updateScaleFactor() {
    this.screenScaleFactor = screen.getPrimaryDisplay().scaleFactor;
  }

  private sendCursorInput(input: CursorInput) {
    const x = input.clientX / this.screenScaleFactor;
    const y = input.clientY / this.screenScaleFactor;
    const globalX = input.windowX / this.screenScaleFactor;
    const globalY = input.windowY / this.screenScaleFactor;
    const movementX = globalX - this.lastWindowCursor.x;
    const movementY = globalY - this.lastWindowCursor.y;
    const common = {
      x,
      y,
      globalX,
      globalY,
      movementX,
      movementY,
      modifiers: this.modifiers,
    };

    if (input.kind === "Action") {
      this.sendCursorAction(input, common);
    } else if (input.kind === "Scroll") {
      this.contents.sendInputEvent({
        type: "mouseWheel",
        ...(input.axis === "Y"
          ? { deltaY: input.delta }
          : { deltaX: input.delta }),
        ...common,
      });
    } else {
      this.contents.sendInputEvent({
        type:
          input.kind === "Enter"
            ? "mouseEnter"
            : input.kind === "Leave"
              ? "mouseLeave"
              : "mouseMove",
        ...common,
      });
    }

    this.lastWindowCursor = { x: globalX, y: globalY };
  }

  private sendCursorAction(
    input: Extract<CursorInput, { kind: "Action" }>,
    common: {
      x: number;
      y: number;
      globalX: number;
      globalY: number;
      movementX: number;
      movementY: number;
      modifiers: Array<"shift" | "ctrl" | "alt" | "meta" | "cmd">;
    }
  ) {
    if (input.action === "Forward" || input.action === "Back") {
      if (input.state === "Pressed") {
        if (input.action === "Forward")
          this.contents.navigationHistory.goForward();
        else this.contents.navigationHistory.goBack();
      }
      return;
    }

    const button = input.action.toLowerCase() as "left" | "middle" | "right";
    if (input.state === "Pressed") {
      const clickCount = input.doubleClick ? 2 : 1;
      this.clickCounts.push(clickCount);
      this.contents.sendInputEvent({
        type: "mouseDown",
        button,
        clickCount,
        ...common,
      });
    } else {
      this.contents.sendInputEvent({
        type: "mouseUp",
        button,
        clickCount: this.clickCounts.pop() ?? 1,
        ...common,
      });
    }
  }

  private sendKeyboardInput(input: KeyboardInput) {
    if (input.kind === "Char") {
      this.contents.sendInputEvent({
        type: "char",
        keyCode: input.ch,
        modifiers: this.modifiers,
      });
      return;
    }
    if (input.kind === "Ime") {
      if (input.ime.kind === "Commit" && input.ime.text) {
        for (const character of input.ime.text) {
          this.contents.sendInputEvent({
            type: "char",
            keyCode: character,
            modifiers: this.modifiers,
          });
        }
      }
      return;
    }

    const keyCode = mapVirtualKey(input.key.code);
    if (!keyCode) return;
    const pressed = input.state === "Pressed";
    this.updateModifiers(keyCode, pressed);
    this.contents.sendInputEvent({
      type: pressed ? "keyDown" : "keyUp",
      keyCode,
      modifiers: this.modifiers,
    });
  }

  private updateModifiers(keyCode: string, pressed: boolean) {
    if (keyCode === "Shift") this.modifierState.shift = pressed;
    else if (keyCode === "Control") this.modifierState.ctrl = pressed;
    else if (keyCode === "Alt") this.modifierState.alt = pressed;
    else if (keyCode === "Super") this.modifierState.super = pressed;
    else if (keyCode === "Meta") this.modifierState.meta = pressed;
    else return;

    this.modifiers = [];
    if (this.modifierState.shift) this.modifiers.push("shift");
    if (this.modifierState.ctrl) this.modifiers.push("ctrl");
    if (this.modifierState.alt) this.modifiers.push("alt");
    if (this.modifierState.meta) this.modifiers.push("meta");
    if (this.modifierState.super) this.modifiers.push("cmd");
  }
}
