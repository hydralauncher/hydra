import type { HydraOverlayContext } from "@types";
import { Gamepad2, Keyboard } from "lucide-react";
import { useEffect, useState } from "react";

import "./overlay.scss";

export default function OverlayToast() {
  const [context, setContext] = useState<HydraOverlayContext | null>(null);

  useEffect(() => {
    globalThis.electron.getOverlayContext().then(setContext);
  }, []);

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
        <strong>
          <Keyboard size={20} /> {context.shortcut.replaceAll("+", " + ")}
        </strong>
        <small>
          <Gamepad2 size={13} /> {context.controllerShortcut}
        </small>
      </section>
    </div>
  );
}
