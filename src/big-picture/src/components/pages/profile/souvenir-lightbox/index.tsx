import "./styles.scss";

import { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import type { ProfileAchievement } from "@types";

import { Backdrop, Typography } from "../../../common";
import { useNavigationScreenActions } from "../../../../hooks";

export interface SouvenirLightboxProps {
  souvenir: ProfileAchievement | null;
  onClose: () => void;
}

export function SouvenirLightbox({
  souvenir,
  onClose,
}: Readonly<SouvenirLightboxProps>) {
  useNavigationScreenActions(souvenir ? { press: { b: onClose } } : {});

  useEffect(() => {
    if (!souvenir) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    globalThis.window.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, souvenir]);

  return (
    <AnimatePresence>
      {souvenir ? (
        <Backdrop>
          <div className="souvenir-lightbox">
            <img
              className="souvenir-lightbox__image"
              src={souvenir.imageUrl}
              alt={souvenir.displayName}
              draggable={false}
            />

            <div className="souvenir-lightbox__caption">
              {souvenir.achievementIcon ? (
                <img
                  className="souvenir-lightbox__icon"
                  src={souvenir.achievementIcon}
                  alt=""
                  draggable={false}
                />
              ) : null}

              <div className="souvenir-lightbox__copy">
                <Typography className="souvenir-lightbox__title">
                  {souvenir.displayName}
                </Typography>

                {souvenir.description ? (
                  <Typography className="souvenir-lightbox__description">
                    {souvenir.description}
                  </Typography>
                ) : null}
              </div>
            </div>
          </div>
        </Backdrop>
      ) : null}
    </AnimatePresence>
  );
}
