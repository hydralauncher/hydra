import { create } from "zustand";
import { NavigationService } from "../services";

export type InputMode = "gamepad" | "mouse";

interface InputModeState {
  mode: InputMode;
  lastMouseFocusId: string | null;
  pendingGamepadFocus: boolean;
  setGamepadMode: () => void;
  setMouseMode: () => void;
  setLastMouseFocusId: (id: string | null) => void;
  clearPendingGamepadFocus: () => void;
}

export const useInputModeStore = create<InputModeState>()((set, get) => ({
  mode: "gamepad",
  lastMouseFocusId: null,
  pendingGamepadFocus: false,

  setGamepadMode: () => {
    if (get().mode === "gamepad") return;
    const lastMouseFocusId = get().lastMouseFocusId;
    set({
      mode: "gamepad",
      lastMouseFocusId: null,
      pendingGamepadFocus: !!lastMouseFocusId,
    });
    if (lastMouseFocusId) {
      NavigationService.getInstance().setFocus(lastMouseFocusId);
    }
  },

  setMouseMode: () => {
    if (get().mode === "mouse") return;
    set({ mode: "mouse" });
  },

  setLastMouseFocusId: (id) => {
    set({ lastMouseFocusId: id });
  },

  clearPendingGamepadFocus: () => {
    set({ pendingGamepadFocus: false });
  },
}));
