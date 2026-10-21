import { useEffect } from "react";
import { create } from "zustand";

interface ScreenshotDialogPresenceState {
  openCount: number;
  add: () => void;
  remove: () => void;
}

export const useScreenshotDialogPresenceStore =
  create<ScreenshotDialogPresenceState>((set) => ({
    openCount: 0,
    add: () => set((state) => ({ openCount: state.openCount + 1 })),
    remove: () =>
      set((state) => ({ openCount: Math.max(0, state.openCount - 1) })),
  }));

export function useScreenshotDialogPresence(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return;

    const { add, remove } = useScreenshotDialogPresenceStore.getState();
    add();
    return remove;
  }, [isOpen]);
}

export function ScreenshotDialogPresence({
  isOpen,
}: Readonly<{ isOpen: boolean }>) {
  useScreenshotDialogPresence(isOpen);
  return null;
}
