import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PeopleIcon, PinIcon, TrophyIcon, XIcon } from "@primer/octicons-react";
import cn from "classnames";
import { formatOverlayHotkey, normalizeOverlayHotkey } from "@shared";

import { Avatar } from "@renderer/components";
import { setUserPreferences } from "@renderer/features";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import type { OverlayPanel, OverlayState } from "@types";

const electron = globalThis.electron as Electron;

interface OverlayDockProps {
  state: OverlayState;
}

const panelStatus = (state: OverlayState, panel: OverlayPanel) =>
  state.panels.find((item) => item.panel === panel);

export function OverlayDock({ state }: Readonly<OverlayDockProps>) {
  const { t } = useTranslation("overlay");
  const dispatch = useAppDispatch();
  const preferences = useAppSelector((state) => state.userPreferences.value);

  useEffect(() => {
    let cancelled = false;

    void electron
      .getUserPreferences()
      .then((value) => {
        if (!cancelled) dispatch(setUserPreferences(value));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  if (!state.game) return null;

  const overlayHotkey = normalizeOverlayHotkey(preferences?.overlayHotkey);
  const chat = panelStatus(state, "chat");
  const achievements = panelStatus(state, "achievements");
  const showAchievements = state.game.achievementCount !== 0;

  return (
    <div className="overlay-dock">
      <div className="overlay-dock__bar">
        <div className="overlay-dock__game">
          <Avatar
            size={32}
            src={state.game.iconUrl}
            alt=""
            className="overlay-dock__game-icon"
          />
          <div className="overlay-dock__game-details">
            <span className="overlay-dock__game-title" title={state.game.title}>
              {state.game.title}
            </span>
            <span className="overlay-dock__shortcut">
              {t("hotkey_hint", { key: formatOverlayHotkey(overlayHotkey) })}
            </span>
          </div>
        </div>

        <span className="overlay-dock__divider" aria-hidden="true" />

        <nav className="overlay-dock__actions" aria-label={t("title")}>
          <button
            type="button"
            className={cn("overlay-dock__button", {
              "overlay-dock__button--active": chat?.isOpen,
            })}
            onClick={() => void electron.openOverlayPanel("chat")}
            aria-pressed={Boolean(chat?.isOpen)}
          >
            <PeopleIcon size={20} />
            <span>{t("chat")}</span>
            {chat?.isPinned && (
              <PinIcon size={10} className="overlay-dock__pin" />
            )}
          </button>

          {showAchievements && (
            <button
              type="button"
              className={cn("overlay-dock__button", {
                "overlay-dock__button--active": achievements?.isOpen,
              })}
              onClick={() => void electron.openOverlayPanel("achievements")}
              aria-pressed={Boolean(achievements?.isOpen)}
            >
              <TrophyIcon size={20} />
              <span>{t("achievements")}</span>
              {achievements?.isPinned && (
                <PinIcon size={10} className="overlay-dock__pin" />
              )}
            </button>
          )}
        </nav>

        <span className="overlay-dock__divider" aria-hidden="true" />

        <button
          type="button"
          className="overlay-dock__close"
          onClick={() => void electron.closeOverlay()}
          title={t("close")}
          aria-label={t("close")}
        >
          <XIcon size={18} />
        </button>
      </div>
    </div>
  );
}
