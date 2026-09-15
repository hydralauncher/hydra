import { useTranslation } from "react-i18next";
import { Button, Modal } from "@renderer/components";
import type { Game } from "@types";
import { getPlayTimeHoursAndMinutes } from "@shared";
import "./reset-achievements-modal.scss";

type ResetPlaytimeModalProps = Readonly<{
  visible: boolean;
  game: Game;
  onClose: () => void;
  resetPlaytime: () => Promise<void>;
}>;

export function ResetPlaytimeModal({
  onClose,
  game,
  visible,
  resetPlaytime,
}: ResetPlaytimeModalProps) {
  const { t } = useTranslation("game_details");
  const steamPlayTimeInMilliseconds = game.steamPlayTimeInMilliseconds ?? 0;

  const handleResetPlaytime = async () => {
    try {
      await resetPlaytime();
    } finally {
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={t("reset_playtime_title")}
      description={t("reset_playtime_description", {
        game: game.title,
      })}
    >
      {steamPlayTimeInMilliseconds > 0 ? (
        <p className="reset-achievements-modal__retroachievements-note">
          {t("reset_playtime_steam_note", {
            hydra: t(
              "playtime_hours_and_minutes",
              getPlayTimeHoursAndMinutes(game.playTimeInMilliseconds ?? 0)
            ),
            steam: t(
              "playtime_hours_and_minutes",
              getPlayTimeHoursAndMinutes(steamPlayTimeInMilliseconds)
            ),
          })}
        </p>
      ) : null}
      <div className="reset-achievements-modal__actions">
        <Button onClick={onClose} theme="outline">
          {t("cancel")}
        </Button>

        <Button onClick={handleResetPlaytime} theme="primary">
          {t("reset_playtime")}
        </Button>
      </div>
    </Modal>
  );
}
