import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useFormat } from "./use-format";
import { useTranslation } from "react-i18next";
import { buildGameDetailsPath } from "@renderer/helpers";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { LibraryGame } from "@types";

export function useGameCard(
  game: LibraryGame,
  onContextMenu: (game: LibraryGame, position: { x: number; y: number }) => void
) {
  const { t } = useTranslation("library");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();

  const formatPlayTime = useCallback(
    (playTimeInMilliseconds = 0, isShort = false) => {
      const minutes = playTimeInMilliseconds / 60000;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t(isShort ? "amount_minutes_short" : "amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      const hoursKey = isShort ? "amount_hours_short" : "amount_hours";
      const hoursAmount = isShort
        ? Math.floor(hours)
        : numberFormatter.format(hours);

      return t(hoursKey, { amount: hoursAmount });
    },
    [numberFormatter, t]
  );

  const handleCardClick = useCallback(() => {
    navigate(buildGameDetailsPath(game));
  }, [navigate, game]);

  const handleContextMenuClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(game, { x: e.clientX, y: e.clientY });
    },
    [game, onContextMenu]
  );

  const handleMenuButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      onContextMenu(game, { x: rect.right, y: rect.bottom });
    },
    [game, onContextMenu]
  );

  return {
    formatPlayTime,
    handleCardClick,
    handleContextMenuClick,
    handleMenuButtonClick,
  };
}
