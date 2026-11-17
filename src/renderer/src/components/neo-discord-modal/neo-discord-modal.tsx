import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { XIcon } from "@primer/octicons-react";
import cn from "classnames";

import neoHero from "@renderer/assets/neo-hero.jpg";

import { Backdrop } from "../backdrop/backdrop";

import "./neo-discord-modal.scss";

const CLOSE_ANIMATION_MS = 200;

const STEPS = ["neo_discord_step_close_hydra", "neo_discord_step_logs"];

const STATS = [
  {
    label: "neo_discord_stats_memory",
    neo: "150 MB",
    neoWidth: 17,
    today: "890 MB",
    note: null,
  },
  {
    label: "neo_discord_stats_speed",
    neo: "~0.5 s",
    neoWidth: 8,
    today: "~6 s",
    note: "neo_discord_stats_faster",
  },
];

export interface NeoDiscordModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function NeoDiscordDialog({
  onClose,
  onConfirm,
}: Readonly<Omit<NeoDiscordModalProps, "visible">>) {
  const { t } = useTranslation("sidebar");
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isClosing, setIsClosing] = useState(false);

  const close = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!dialogRef.current?.contains(event.target as Node)) close();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [close]);

  return createPortal(
    <Backdrop isClosing={isClosing}>
      <dialog
        ref={dialogRef}
        className={cn("modal", "neo-discord-modal", {
          "modal--closing": isClosing,
        })}
        open
        aria-modal="true"
        aria-labelledby={titleId}
        data-hydra-dialog
      >
        <button
          type="button"
          className="neo-discord-modal__close"
          onClick={close}
          aria-label={t("neo_discord_close")}
        >
          <XIcon size={16} />
        </button>

        <img className="neo-discord-modal__hero" src={neoHero} alt="" />

        <div className="neo-discord-modal__body">
          <p className="neo-discord-modal__eyebrow">
            <span className="neo-discord-modal__diamond" aria-hidden />
            {t("neo_discord_eyebrow")}
          </p>

          <h2 id={titleId} className="neo-discord-modal__title">
            {t("neo_discord_title")}
          </h2>

          <p className="neo-discord-modal__text">
            {t("neo_discord_description")}
          </p>

          <button
            type="button"
            className="neo-discord-modal__cta"
            onClick={onConfirm}
          >
            {t("neo_discord_confirm")}
          </button>

          <section className="neo-discord-modal__section">
            <p className="neo-discord-modal__label">
              {t("neo_discord_before_title")}
            </p>
            <ol className="neo-discord-modal__steps">
              {STEPS.map((step, index) => (
                <li key={step} className="neo-discord-modal__step">
                  <span className="neo-discord-modal__number">
                    0{index + 1}
                  </span>
                  <span>{t(step)}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="neo-discord-modal__section">
            <p className="neo-discord-modal__label">
              {t("neo_discord_stats_title")}
            </p>
            {STATS.map((stat) => (
              <div key={stat.label} className="neo-discord-modal__stat">
                <p className="neo-discord-modal__stat-title">
                  {t(stat.label)}
                  {stat.note && (
                    <span className="neo-discord-modal__stat-note">
                      {" · "}
                      {t(stat.note)}
                    </span>
                  )}
                </p>
                <div className="neo-discord-modal__bar-row neo-discord-modal__bar-row--neo">
                  <span className="neo-discord-modal__bar-label">Neo</span>
                  <span className="neo-discord-modal__bar-track">
                    <span
                      className="neo-discord-modal__bar"
                      style={{ width: `${stat.neoWidth}%` }}
                    />
                  </span>
                  <span className="neo-discord-modal__bar-value">
                    {stat.neo}
                  </span>
                </div>
                <div className="neo-discord-modal__bar-row">
                  <span className="neo-discord-modal__bar-label">Hydra</span>
                  <span className="neo-discord-modal__bar-track">
                    <span
                      className="neo-discord-modal__bar"
                      style={{ width: "100%" }}
                    />
                  </span>
                  <span className="neo-discord-modal__bar-value">
                    {stat.today}
                  </span>
                </div>
              </div>
            ))}
          </section>

          <p className="neo-discord-modal__safety">{t("neo_discord_safety")}</p>
        </div>
      </dialog>
    </Backdrop>,
    document.body
  );
}

export function NeoDiscordModal({
  visible,
  ...props
}: Readonly<NeoDiscordModalProps>) {
  if (!visible) return null;

  return <NeoDiscordDialog {...props} />;
}
