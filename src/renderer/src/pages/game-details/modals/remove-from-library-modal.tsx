import { useTranslation } from "react-i18next";
import { Button, Modal } from "@renderer/components";
import type { Game } from "@types";
import "./remove-from-library-modal.scss";

interface RemoveGameFromLibraryModalProps {
  visible: boolean;
  game: Game;
  onClose: () => void;
  removeGameFromLibrary: () => Promise<void>;
}

export function RemoveGameFromLibraryModal({
  onClose,
  game,
  visible,
  removeGameFromLibrary,
}: RemoveGameFromLibraryModalProps) {
  const { t } = useTranslation("game_details");

  const handleRemoveGame = async () => {
    await removeGameFromLibrary();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("remove_from_library_title")}
      description={t("remove_from_library_description", { game: game.title })}
      onClose={onClose}
    >
      <div className="remove-from-library-modal__actions">
        <Button onClick={onClose} theme="outline">
          {t("cancel")}
        </Button>

        <Button onClick={handleRemoveGame} theme="primary">
          {t("remove")}
        </Button>
      </div>
    </Modal>
  );
}
