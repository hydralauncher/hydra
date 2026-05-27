import { create } from "zustand";

interface VirtualKeyboardStoreState {
  target: HTMLElement | null;
  setTarget: (target: HTMLElement | null) => void;
}

export const useVirtualKeyboardStore = create<VirtualKeyboardStoreState>(
  (set) => ({
    target: null,
    setTarget: (target) => set({ target }),
  })
);
