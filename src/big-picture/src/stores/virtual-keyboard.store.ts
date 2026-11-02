import { create } from "zustand";

interface VirtualKeyboardStoreState {
  target: HTMLElement | null;
  openKeyboard: ((target: HTMLElement) => void) | null;
  closeKeyboard: ((options?: { restoreFocus?: boolean }) => void) | null;
  setTarget: (target: HTMLElement | null) => void;
  setOpenKeyboard: (
    openKeyboard: ((target: HTMLElement) => void) | null
  ) => void;
  setCloseKeyboard: (
    closeKeyboard: ((options?: { restoreFocus?: boolean }) => void) | null
  ) => void;
}

export const useVirtualKeyboardStore = create<VirtualKeyboardStoreState>(
  (set) => ({
    target: null,
    openKeyboard: null,
    closeKeyboard: null,
    setTarget: (target) => set({ target }),
    setOpenKeyboard: (openKeyboard) => set({ openKeyboard }),
    setCloseKeyboard: (closeKeyboard) => set({ closeKeyboard }),
  })
);
