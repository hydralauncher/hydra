import { useTranslation } from "react-i18next";
import { Modal } from "@renderer/components";
import type { LibraryGame } from "@types";
import { EpicCloudSettingsSection } from "./game-options-modal/epic-cloud-section";
import "./game-options-modal.scss";

export function EpicCloudSaveConflictModal({
  game,
  isGameRunning,
  onClose,
}: Readonly<{
  game: LibraryGame | null;
  isGameRunning: boolean;
  onClose: () => void;
}>) {
  const { t } = useTranslation("game_details");
  if (!game) return null;

  return (
    <Modal
      visible
      title={t("epic_save_status_conflict")}
      onClose={onClose}
      large
    >
      <EpicCloudSettingsSection game={game} isGameRunning={isGameRunning} />
    </Modal>
  );
}
