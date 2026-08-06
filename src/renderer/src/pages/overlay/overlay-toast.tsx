import type { HydraOverlayContext } from "@types";
import { Gamepad2, Keyboard } from "lucide-react";
import { useEffect, useState } from "react";

import "./overlay.scss";

type OverlayToastProps = Readonly<{
  context?: HydraOverlayContext;
}>;

export default function OverlayToast({
  context: providedContext,
}: OverlayToastProps) {
  const [loadedContext, setLoadedContext] =
    useState<HydraOverlayContext | null>(null);

  useEffect(() => {
    if (providedContext) return;
    const refresh = () =>
      globalThis.electron
        .getOverlayContext()
        .then(setLoadedContext)
        .catch(() => setLoadedContext(null));
    void refresh();
    return globalThis.electron.onOverlayShown(refresh);
  }, [providedContext]);

  const context = providedContext ?? loadedContext;

  if (!context) return null;

  return (
    <div className="overlay-toast overlay-toast--wide">
      {context.game.heroImageUrl && (
        <img
          className="overlay-toast__backdrop"
          src={context.game.heroImageUrl}
          alt=""
        />
      )}
      <div className="overlay-toast__scrim" />
      <section className="overlay-toast__brand">
        {context.game.logoImageUrl ? (
          <img src={context.game.logoImageUrl} alt={context.game.title} />
        ) : (
          <strong>{context.game.title}</strong>
        )}
      </section>
      <section className="overlay-toast__prompt">
        <span>Toggle Hydra overlay</span>
        <div className="overlay-toast__shortcuts">
          <strong>
            <Keyboard size={20} />
            <span>{context.shortcut.replaceAll("+", " + ")}</span>
          </strong>
          <small>
            <Gamepad2 size={20} />
            <span>{context.controllerShortcut}</span>
          </small>
        </div>
      </section>
    </div>
  );
}
