import { useState } from "react";

import { SensitiveScreenshotModal } from "./sensitive-screenshot-modal";
import { useRevealedScreenshotSpoilers } from "./use-revealed-spoilers";
import {
  useSensitiveScreenshotViewer,
  type SensitiveScreenshotTarget,
} from "./use-sensitive-screenshot";

interface PendingSensitiveReveal {
  screenshotId: string;
  isSpoiler: boolean;
  continueWith: () => void;
}

export function useSensitiveScreenshotGate() {
  const { isHidden, reveal } = useSensitiveScreenshotViewer();
  const revealSpoiler = useRevealedScreenshotSpoilers((state) => state.reveal);
  const [pending, setPending] = useState<PendingSensitiveReveal | null>(null);

  const guard = (
    screenshot: SensitiveScreenshotTarget,
    continueWith: () => void
  ) => {
    if (!isHidden(screenshot)) {
      continueWith();
      return;
    }

    setPending({
      screenshotId: screenshot.id,
      isSpoiler: screenshot.isSpoiler,
      continueWith,
    });
  };

  const confirm = () => {
    if (!pending) return;

    reveal(pending.screenshotId);
    if (pending.isSpoiler) revealSpoiler(pending.screenshotId);
    setPending(null);
    pending.continueWith();
  };

  const modal = (
    <SensitiveScreenshotModal
      visible={pending !== null}
      isSpoiler={pending?.isSpoiler ?? false}
      onClose={() => setPending(null)}
      onConfirm={confirm}
    />
  );

  return { isHidden, guard, modal };
}
