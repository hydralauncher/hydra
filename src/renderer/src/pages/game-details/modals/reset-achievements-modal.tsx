import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon } from "@primer/octicons-react";
import { Button, CheckboxField, Link, Modal } from "@renderer/components";
import type { Game } from "@types";
import "./reset-achievements-modal.scss";

const RETRO_ACHIEVEMENTS_SETTINGS_URL =
  "https://retroachievements.org/settings#resettable-game-select";

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

  const handleClose = () => {
    setHasResetOnRetroAchievements(false);
    onClose();
  };

  const handleResetAchievements = async () => {
    try {
      await resetAchievements();
    } finally {
      handleClose();
    }
  };

  const isResetDisabled = isLaunchbox && !hasResetOnRetroAchievements;

  return (
    <Modal
      visible={visible}
      onClose={handleClose}
      title={t("reset_achievements_title")}
      description={t("reset_achievements_description", {
        game: game.title,
      })}
    >
      {isLaunchbox && (
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
