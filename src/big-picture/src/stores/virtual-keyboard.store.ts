import { create } from "zustand";

interface VirtualKeyboardStoreState {
  target: HTMLElement | null;
  closeKeyboard: ((options?: { restoreFocus?: boolean }) => void) | null;
  setTarget: (target: HTMLElement | null) => void;
  setCloseKeyboard: (
    closeKeyboard: ((options?: { restoreFocus?: boolean }) => void) | null
  ) => void;
}

export const useVirtualKeyboardStore = create<VirtualKeyboardStoreState>(
  (set) => ({
    target: null,
    closeKeyboard: null,
    setTarget: (target) => set({ target }),
    setCloseKeyboard: (closeKeyboard) => set({ closeKeyboard }),
  })
);
