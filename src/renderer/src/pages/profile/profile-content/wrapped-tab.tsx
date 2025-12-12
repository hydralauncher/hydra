import { useEffect, useState } from "react";
import { XIcon } from "@primer/octicons-react";
import "./wrapped-tab.scss";

interface WrappedFullscreenModalProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface ScaleConfig {
  scale: number;
  width: number;
  height: number;
}

const SCALE_CONFIGS: Record<number, ScaleConfig> = {
  0.25: { scale: 0.25, width: 270, height: 480 },
  0.3: { scale: 0.3, width: 324, height: 576 },
  0.5: { scale: 0.5, width: 540, height: 960 },
};

const getScaleConfigForHeight = (height: number): ScaleConfig => {
  if (height >= 1000) return SCALE_CONFIGS[0.5];
  if (height >= 650) return SCALE_CONFIGS[0.3];
  return SCALE_CONFIGS[0.25];
};

export function WrappedFullscreenModal({
  userId,
  isOpen,
  onClose,
}: Readonly<WrappedFullscreenModalProps>) {
  const [config, setConfig] = useState<ScaleConfig>(SCALE_CONFIGS[0.5]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    const updateConfig = () => {
      setConfig(getScaleConfigForHeight(window.innerHeight));
    };

    updateConfig();
    window.addEventListener("resize", updateConfig);
    return () => window.removeEventListener("resize", updateConfig);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog className="wrapped-fullscreen-modal" aria-modal="true" open>
      <button
        type="button"
        className="wrapped-fullscreen-modal__backdrop"
        onClick={onClose}
        aria-label="Close wrapped"
      />
      <div className="wrapped-fullscreen-modal__container">
        <button
          type="button"
          className="wrapped-fullscreen-modal__close-button"
          onClick={onClose}
          aria-label="Close wrapped"
        >
          <XIcon size={24} />
        </button>

        <div
          className="wrapped-fullscreen-modal__content"
          style={{ width: config.width, height: config.height }}
        >
          {isLoading && (
            <div className="wrapped-fullscreen-modal__loader">
              <div className="wrapped-fullscreen-modal__spinner" />
            </div>
          )}
          <div className="wrapped-fullscreen-modal__overlay" />
          <iframe
            src={`https://hydrawrapped.com/embed/${userId}?scale=${config.scale}`}
            className="wrapped-fullscreen-modal__iframe"
            title="Wrapped 2025"
            onLoad={() => setIsLoading(false)}
          />
        </div>
      </div>
    </dialog>
  );
}
