import { PlayIcon } from "@primer/octicons-react";
import { XCircle } from "lucide-react";
import type { LibraryGame } from "@types";
import { getLibraryOperationalGame } from "@shared";
import cn from "classnames";
import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector, useGameLaunchActions } from "@renderer/hooks";
import { ConfirmationModal } from "../confirmation-modal/confirmation-modal";

import "./quick-launch-button.scss";

export type QuickLaunchButtonVariant = "card" | "sidebar";

interface QuickLaunchButtonProps {
  game: LibraryGame;
  variant?: QuickLaunchButtonVariant;
  className?: string;
  running?: boolean;
}

export const QuickLaunchButton = memo(function QuickLaunchButton({
  game,
  variant = "card",
  className,
  running,
}: Readonly<QuickLaunchButtonProps>) {
  const { t } = useTranslation("library");
  const { t: tGameDetails } = useTranslation("game_details");
  const operationalGame = useMemo(
    () => getLibraryOperationalGame(game),
    [game]
  );
  const runningGameId = useAppSelector(
    (state) => state.gameRunning.gameRunning?.id
  );
  const isRunning = running === true || runningGameId === operationalGame.id;
  const [isLaunching, setIsLaunching] = useState(false);

  const {
    canPlay,
    rpcs3ConfirmPending,
    handlePlayGame,
    handleCloseGame,
    handleConfirmRpcs3Launch,
    handleCancelRpcs3Launch,
  } = useGameLaunchActions(operationalGame);

  const handleClick = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (isRunning) {
        await handleCloseGame();
        return;
      }

      if (!canPlay || isLaunching) return;

      setIsLaunching(true);
      try {
        await handlePlayGame();
      } finally {
        setIsLaunching(false);
      }
    },
    [canPlay, handleCloseGame, handlePlayGame, isLaunching, isRunning]
  );

  if (!canPlay && !isRunning) return null;

  const state = isRunning ? "running" : isLaunching ? "launching" : "playable";
  const label =
    state === "running"
      ? t("stop")
      : state === "launching"
        ? t("playing")
        : t("play");

  return (
    <>
      <button
        type="button"
        className={cn(
          "quick-launch-button",
          `quick-launch-button--${variant}`,
          `quick-launch-button--${state}`,
          className
        )}
        onClick={handleClick}
        aria-label={label}
        title={label}
      >
        {state === "running" ? (
          <XCircle size={variant === "sidebar" ? 15 : 16} />
        ) : (
          <PlayIcon
            size={variant === "sidebar" ? 15 : 16}
            className="quick-launch-button__icon"
          />
        )}
        {variant === "card" && (
          <span className="quick-launch-button__label">{label}</span>
        )}
      </button>

      {rpcs3ConfirmPending !== null && (
        <ConfirmationModal
          visible
          title={tGameDetails("rpcs3_already_running_title")}
          descriptionText={tGameDetails("rpcs3_already_running_description")}
          confirmButtonLabel={tGameDetails("rpcs3_already_running_confirm")}
          cancelButtonLabel={tGameDetails("cancel")}
          onClose={handleCancelRpcs3Launch}
          onConfirm={handleConfirmRpcs3Launch}
        />
      )}
    </>
  );
});
