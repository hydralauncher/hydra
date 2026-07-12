import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon } from "@primer/octicons-react";
import { Button, CheckboxField, Link, Modal } from "@renderer/components";
import type { Game } from "@types";
import { logger } from "@renderer/logger";
import "./reset-achievements-modal.scss";

const RETRO_ACHIEVEMENTS_SETTINGS_URL =
  "https://retroachievements.org/settings#resettable-game-select";

const isPs3Platform = (platform?: string | null): boolean => {
  return /playstation\s*3|\bps3\b/i.test(platform ?? "");
};

type ResetAchievementsModalProps = Readonly<{
  visible: boolean;
  game: Game;
  onClose: () => void;
  resetAchievements: () => Promise<void>;
}>;

export function ResetAchievementsModal({
  onClose,
  game,
  visible,
  resetAchievements,
}: ResetAchievementsModalProps) {
  const { t } = useTranslation("game_details");

  const [hasResetOnRetroAchievements, setHasResetOnRetroAchievements] =
    useState(false);

  const isLaunchbox = game.shop === "launchbox";
  const isLocalRpcs3Game = isLaunchbox && isPs3Platform(game.platform);
  logger.log("ResetAchievementsModal rendering", {
    gameTitle: game.title,
    isLaunchbox,
    isPs3Platform: isPs3Platform(game.platform),
    isLocalRpcs3Game,
  });
  const showRetroAchievementsResetNote = isLaunchbox && !isLocalRpcs3Game;

  const handleClose = () => {
    setHasResetOnRetroAchievements(false);
    onClose();
  };

  const handleResetAchievements = async () => {
    try {
      await resetAchievements();
    } catch (error) {
      logger.error("Error resetting achievements", {
        error,
        gameTitle: game.title,
      });
      throw error;
    } finally {
      handleClose();
    }
  };

  const isResetDisabled =
    showRetroAchievementsResetNote && !hasResetOnRetroAchievements;

  return (
    <Modal
      visible={visible}
      onClose={handleClose}
      title={t("reset_achievements_title")}
      description={t("reset_achievements_description", {
        game: game.title,
      })}
    >
      {showRetroAchievementsResetNote && (
        <div className="reset-achievements-modal__retroachievements">
          <p className="reset-achievements-modal__retroachievements-note">
            {t("reset_achievements_retroachievements_note")}
          </p>

          <Link
            to={RETRO_ACHIEVEMENTS_SETTINGS_URL}
            className="reset-achievements-modal__retroachievements-link"
          >
            <LinkExternalIcon />
            {t("reset_achievements_retroachievements_link")}
          </Link>

          <CheckboxField
            label={t("reset_achievements_retroachievements_confirm")}
            checked={hasResetOnRetroAchievements}
            onChange={() => setHasResetOnRetroAchievements((prev) => !prev)}
          />
        </div>
      )}

      <div className="reset-achievements-modal__actions">
        <Button onClick={handleClose} theme="outline">
          {t("cancel")}
        </Button>

        <Button
          onClick={handleResetAchievements}
          theme="primary"
          disabled={isResetDisabled}
        >
          {t("reset_achievements")}
        </Button>
      </div>
    </Modal>
  );
}
