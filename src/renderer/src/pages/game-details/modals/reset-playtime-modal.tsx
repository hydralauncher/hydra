import { useTranslation } from "react-i18next";
import { Button, Modal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { Game } from "@types";
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

  const { showErrorToast } = useToast();

  const handleResetPlaytime = async () => {
    try {
      await resetPlaytime();
    } catch (error) {
      showErrorToast(t("reset_playtime_error"));
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
