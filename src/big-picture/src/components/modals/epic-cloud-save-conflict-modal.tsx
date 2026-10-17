import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { Modal } from "../common";
import { EpicCloudSaves } from "../pages/game/epic-cloud-saves";

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
    <Modal visible title={t("epic_save_status_conflict")} onClose={onClose}>
      <EpicCloudSaves game={game} isGameRunning={isGameRunning} />
    </Modal>
  );
}
