import { create } from "zustand";
import { NavigationService } from "../services/navigation.service";

export type InputMode = "gamepad" | "mouse";
export interface FocusSnapshot {
  focusId: string;
  capturedAt: number;
}

export const MOUSE_FOCUS_RESTORE_WINDOW_MS = 1000;

const GAMEPAD_STYLE_ID = "bp-input-mode-gamepad-style";

function applyGamepadStyle() {
  if (document.getElementById(GAMEPAD_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = GAMEPAD_STYLE_ID;
  style.textContent = `
    #big-picture[data-bp-input-mode="gamepad"],
    #big-picture[data-bp-input-mode="gamepad"] * {
      cursor: none !important;
    }
    #big-picture[data-bp-input-mode="gamepad"] * {
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
  document.body.offsetHeight;
}

function removeGamepadStyle() {
  document.getElementById(GAMEPAD_STYLE_ID)?.remove();
}

interface InputModeState {
  mode: InputMode;
  mouseFocusSnapshot: FocusSnapshot | null;
  gamepadFocusSnapshot: FocusSnapshot | null;
  pendingGamepadFocus: boolean;
  setGamepadMode: (now?: number) => void;
  setMouseMode: () => void;
  setMouseFocusSnapshot: (focusId: string | null, now?: number) => void;
  setGamepadFocusSnapshot: (focusId: string | null, now?: number) => void;
  clearPendingGamepadFocus: () => void;
}

export const useInputModeStore = create<InputModeState>()((set, get) => ({
  mode: "gamepad",
  mouseFocusSnapshot: null,
  gamepadFocusSnapshot: null,
  pendingGamepadFocus: false,

  setGamepadMode: (now = Date.now()) => {
    if (get().mode === "gamepad") return;

    const navigation = NavigationService.getInstance();
    const snapshot = get().mouseFocusSnapshot;
    const gamepadSnapshot = get().gamepadFocusSnapshot;
    let restoredFocusId: string | null = null;

    if (
      snapshot &&
      now - snapshot.capturedAt <= MOUSE_FOCUS_RESTORE_WINDOW_MS &&
      navigation.getNode(snapshot.focusId)
    ) {
      restoredFocusId = navigation.setFocus(snapshot.focusId);
    }

    if (
      !restoredFocusId &&
      gamepadSnapshot &&
      navigation.getNode(gamepadSnapshot.focusId)
    ) {
      restoredFocusId = navigation.setFocus(gamepadSnapshot.focusId);
    }

    set({
      mode: "gamepad",
      mouseFocusSnapshot: null,
      pendingGamepadFocus: Boolean(restoredFocusId),
    });

    applyGamepadStyle();
  },

  setMouseMode: () => {
    if (get().mode === "mouse") return;
    set({ mode: "mouse" });
    removeGamepadStyle();
  },

  setMouseFocusSnapshot: (focusId, now = Date.now()) => {
    set({
      mouseFocusSnapshot: focusId
        ? {
            focusId,
            capturedAt: now,
          }
        : null,
    });
  },

  setGamepadFocusSnapshot: (focusId, now = Date.now()) => {
    set({
      gamepadFocusSnapshot: focusId
        ? {
            focusId,
            capturedAt: now,
          }
        : null,
    });
  },

  clearPendingGamepadFocus: () => {
    set({ pendingGamepadFocus: false });
  },
}));
