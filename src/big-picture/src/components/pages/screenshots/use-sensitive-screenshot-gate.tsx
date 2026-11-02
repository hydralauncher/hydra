import { useRef, useState } from "react";

import { SensitiveScreenshotModal } from "./sensitive-screenshot-modal";
import { useRevealedScreenshotSpoilers } from "./use-revealed-spoilers";
import {
  useSensitiveScreenshotViewer,
  type SensitiveScreenshotTarget,
} from "./use-sensitive-screenshot";

interface SensitiveRevealRequest {
  screenshotId: string;
  isSpoiler: boolean;
  continueWith: () => void;
}

export function useSensitiveScreenshotGate() {
  const { isHidden, reveal } = useSensitiveScreenshotViewer();
  const revealSpoiler = useRevealedScreenshotSpoilers((state) => state.reveal);
  const [request, setRequest] = useState<SensitiveRevealRequest | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const confirmedRef = useRef<(() => void) | null>(null);

  const guard = (
    screenshot: SensitiveScreenshotTarget,
    continueWith: () => void
  ) => {
    if (!isHidden(screenshot)) {
      continueWith();
      return;
    }

    confirmedRef.current = null;
    setRequest({
      screenshotId: screenshot.id,
      isSpoiler: screenshot.isSpoiler,
      continueWith,
    });
    setIsVisible(true);
  };

  const confirm = () => {
    if (!request || !isVisible) return;

    reveal(request.screenshotId);
    if (request.isSpoiler) revealSpoiler(request.screenshotId);
    confirmedRef.current = request.continueWith;
    setIsVisible(false);
  };

  const finishExit = () => {
    const continueWith = confirmedRef.current;
    confirmedRef.current = null;
    setRequest(null);
    continueWith?.();
  };

  const modal = request ? (
    <SensitiveScreenshotModal
      visible={isVisible}
      isSpoiler={request.isSpoiler}
      onClose={() => setIsVisible(false)}
      onConfirm={confirm}
      onExitComplete={finishExit}
    />
  ) : null;

  return { isHidden, guard, modal };
}
