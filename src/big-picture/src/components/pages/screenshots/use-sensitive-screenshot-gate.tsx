import { useState } from "react";

import { SensitiveScreenshotModal } from "./sensitive-screenshot-modal";
import {
  useSensitiveScreenshotViewer,
  type SensitiveScreenshotTarget,
} from "./use-sensitive-screenshot";

interface PendingSensitiveReveal {
  screenshotId: string;
  continueWith: () => void;
}

export function useSensitiveScreenshotGate() {
  const { isHidden, reveal } = useSensitiveScreenshotViewer();
  const [pending, setPending] = useState<PendingSensitiveReveal | null>(null);

  const guard = (
    screenshot: SensitiveScreenshotTarget,
    continueWith: () => void
  ) => {
    if (!isHidden(screenshot)) {
      continueWith();
      return;
    }

    setPending({ screenshotId: screenshot.id, continueWith });
  };

  const confirm = () => {
    if (!pending) return;

    reveal(pending.screenshotId);
    setPending(null);
    pending.continueWith();
  };

  const modal = (
    <SensitiveScreenshotModal
      visible={pending !== null}
      onClose={() => setPending(null)}
      onConfirm={confirm}
    />
  );

  return { isHidden, guard, modal };
}
