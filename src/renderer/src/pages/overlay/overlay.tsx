import { useEffect, useState } from "react";
import cn from "classnames";
import type { OverlayState } from "@types";

import { OverlayBigPicture } from "./overlay-big-picture";
import { OverlayDock } from "./overlay-dock";

import "../../app.scss";
import "./overlay.scss";

const electron = globalThis.electron as Electron;

export default function Overlay() {
  const [overlayState, setOverlayState] = useState<OverlayState | null>(null);

  useEffect(() => {
    let cancelled = false;

    void electron.getOverlayState().then((state) => {
      if (!cancelled) setOverlayState(state);
    });

    const unsubscribe = electron.onOverlayState((state) => {
      setOverlayState(state);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!overlayState?.isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void electron.closeOverlay();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [overlayState?.isOpen]);

  if (!overlayState?.isOpen || !overlayState.game) return null;

  return (
    <div
      className={cn("overlay-surface", {
        "overlay-surface--closing": overlayState.isClosing,
      })}
    >
      {overlayState.mode === "bigPicture" ? (
        <OverlayBigPicture
          game={overlayState.game}
          panels={overlayState.panels}
        />
      ) : (
        <OverlayDock state={overlayState} />
      )}
    </div>
  );
}
