import { create } from "zustand";
import { revealScreenshotSpoiler } from "@shared";

interface RevealedScreenshotSpoilersState {
  revealedIds: ReadonlySet<string>;
  reveal: (screenshotId: string) => void;
}

export const useRevealedScreenshotSpoilers =
  create<RevealedScreenshotSpoilersState>((set) => ({
    revealedIds: new Set(),
    reveal: (screenshotId) => {
      revealScreenshotSpoiler(screenshotId);
      set((state) => {
        if (state.revealedIds.has(screenshotId)) return state;

        const revealedIds = new Set(state.revealedIds);
        revealedIds.add(screenshotId);
        return { revealedIds };
      });
    },
  }));
