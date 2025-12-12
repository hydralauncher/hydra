import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "@primer/octicons-react";
import { ConfirmationModal } from "@renderer/components";
import "./wrapped-tab.scss";

interface WrappedModalProps {
  userId: string;
  displayName: string;
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

export function WrappedConfirmModal({
  userId,
  displayName,
  isOpen,
  onClose,
}: Readonly<WrappedModalProps>) {
  const { t } = useTranslation("user_profile");
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [config, setConfig] = useState<ScaleConfig>(SCALE_CONFIGS[0.5]);

  useEffect(() => {
    if (!showFullscreen) return;

    const updateConfig = () => {
      setConfig(getScaleConfigForHeight(window.innerHeight));
    };

    updateConfig();
    window.addEventListener("resize", updateConfig);
    return () => window.removeEventListener("resize", updateConfig);
  }, [showFullscreen]);

  const handleConfirm = () => {
    onClose();
    setShowFullscreen(true);
  };

  return (
    <>
      <ConfirmationModal
        visible={isOpen}
        title={t("wrapped_2025")}
        descriptionText={t("view_wrapped_title", { displayName })}
        confirmButtonLabel={t("view_wrapped_yes")}
        cancelButtonLabel={t("view_wrapped_no")}
        onConfirm={handleConfirm}
        onClose={onClose}
      />

      {showFullscreen && (
        <dialog className="wrapped-fullscreen-modal" aria-modal="true" open>
          <button
            type="button"
            className="wrapped-fullscreen-modal__backdrop"
            onClick={() => setShowFullscreen(false)}
            aria-label="Close wrapped"
          />
          <div className="wrapped-fullscreen-modal__container">
            <button
              type="button"
              className="wrapped-fullscreen-modal__close-button"
              onClick={() => setShowFullscreen(false)}
              aria-label="Close wrapped"
            >
              <XIcon size={24} />
            </button>

            <div
              className="wrapped-fullscreen-modal__content"
              style={{ width: config.width, height: config.height }}
            >
              <iframe
                src={`https://hydrawrapped.com/embed/${userId}?scale=${config.scale}`}
                className="wrapped-fullscreen-modal__iframe"
                title="Wrapped 2025"
              />
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
