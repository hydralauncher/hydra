import { useTranslation } from "react-i18next";
import { Button, Modal } from "@renderer/components";
import * as styles from "./remove-from-library-modal.css";
import type { Game } from "@types";

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

  const handleResetAchievements = async () => {
    await resetAchievements();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("reset_achievements_title")}
      description={t("reset_achievements_description", {
        game: game.title,
      })}
      onClose={onClose}
    >
      <div className={styles.deleteActionsButtonsCtn}>
        <Button onClick={handleResetAchievements} theme="outline">
          {t("reset_achievements")}
        </Button>

        <Button onClick={onClose} theme="primary">
          {t("cancel")}
        </Button>
      </div>
    </Modal>
  );
}
