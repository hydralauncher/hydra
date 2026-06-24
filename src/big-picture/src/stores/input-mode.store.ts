import { create } from "zustand";

export type InputMode = "gamepad" | "mouse";

interface InputModeState {
  mode: InputMode;
  setGamepadMode: () => void;
  setMouseMode: () => void;
}

export const useInputModeStore = create<InputModeState>()((set, get) => ({
  mode: "mouse",

  setGamepadMode: () => {
    if (get().mode === "gamepad") return;
    set({ mode: "gamepad" });
  },

  setMouseMode: () => {
    if (get().mode === "mouse") return;
    set({ mode: "mouse" });
  },
}));
