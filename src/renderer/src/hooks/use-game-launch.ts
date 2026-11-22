import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import type { GameShop } from "@types";
import {
  buildGameDetailsPath,
  handleClassicsLaunchError,
} from "@renderer/helpers";
import { logger } from "@renderer/logger";
import { useToast } from "./use-toast";

export interface GameLaunchTarget {
  objectId: string;
  shop: GameShop;
  title: string;
  executablePath?: string | null;
  discs?: { path: string }[];
  selectedDiscPath?: string | null;
  dontAskDiscSelection?: boolean;
  launchOptions?: string | null;
}

export const canLaunchGame = (game: GameLaunchTarget) =>
  Boolean(game.executablePath) ||
  (game.shop === "launchbox" && (game.discs?.length ?? 0) > 0);

export function useGameLaunchActions(game: GameLaunchTarget) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [rpcs3ConfirmPending, setRpcs3ConfirmPending] = useState<{
    discPath?: string;
  } | null>(null);

  const isClassics = game.shop === "launchbox";
  const canPlay = canLaunchGame(game);

  const launchClassicsAttempt = useCallback(
    async (discPath: string | undefined, force?: boolean): Promise<void> => {
      try {
        await globalThis.electron.openClassicsGame(
          game.shop,
          game.objectId,
          discPath,
          force
        );
      } catch (error) {
        const shouldLog = handleClassicsLaunchError(error, {
          t,
          showErrorToast,
          showSuccessToast,
          navigate,
          onEmulatorAlreadyRunning: () => setRpcs3ConfirmPending({ discPath }),
        });
        if (shouldLog) {
          logger.error("Failed to start classics game", error);
        }
      }
    },
    [game.shop, game.objectId, navigate, showErrorToast, showSuccessToast, t]
  );

  const handleConfirmRpcs3Launch = useCallback(async () => {
    const pending = rpcs3ConfirmPending;
    setRpcs3ConfirmPending(null);
    if (pending) await launchClassicsAttempt(pending.discPath, true);
  }, [rpcs3ConfirmPending, launchClassicsAttempt]);

  const handleCancelRpcs3Launch = useCallback(() => {
    setRpcs3ConfirmPending(null);
  }, []);

  const handlePlayGame = async () => {
    const detailsPath = buildGameDetailsPath({
      ...game,
      objectId: game.objectId,
    });

    if (!canPlay) {
      if (location.pathname !== detailsPath) {
        navigate(detailsPath, { state: { openRepacks: true } });
      }
      globalThis.dispatchEvent(
        new CustomEvent("hydra:openRepacks", {
          detail: { objectId: game.objectId },
        })
      );
      return;
    }

    if (isClassics) {
      const multipleDiscs = (game.discs?.length ?? 0) > 1;
      const needsModal =
        multipleDiscs && !(game.dontAskDiscSelection && game.selectedDiscPath);

      if (needsModal) {
        navigate(detailsPath, { state: { openDiscSelection: true } });
        globalThis.dispatchEvent(
          new CustomEvent("hydra:openDiscSelection", {
            detail: { objectId: game.objectId },
          })
        );
        return;
      }

      await launchClassicsAttempt(game.selectedDiscPath ?? undefined);
      return;
    }

    try {
      await window.electron.openGame(
        game.shop,
        game.objectId,
        game.executablePath!,
        game.launchOptions
      );
    } catch (error) {
      showErrorToast("Failed to start game");
      logger.error("Failed to start game", error);
    }
  };

  const handleCloseGame = async () => {
    try {
      await window.electron.closeGame(game.shop, game.objectId);
    } catch (error) {
      showErrorToast("Failed to close game");
      logger.error("Failed to close game", error);
    }
  };

  return {
    canPlay,
    rpcs3ConfirmPending,
    handlePlayGame,
    handleCloseGame,
    handleConfirmRpcs3Launch,
    handleCancelRpcs3Launch,
  };
}
