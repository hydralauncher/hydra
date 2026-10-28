import { useTranslation } from "react-i18next";

import { Button } from "../button/button";
import { Modal } from "../modal/modal";

import "./steam-uninstall-modal.scss";

interface SteamUninstallModalProps {
  visible: boolean;
  gameTitle: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function SteamUninstallModal({
  visible,
  gameTitle,
  loading = false,
  onClose,
  onConfirm,
}: Readonly<SteamUninstallModalProps>) {
  const { t } = useTranslation("game_details");

  const handleClose = () => {
    if (!loading) onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("steam_uninstall_title")}
      description={t("steam_uninstall_description", { game: gameTitle })}
      onClose={handleClose}
      clickOutsideToClose={!loading}
    >
      <div className="steam-uninstall-modal__actions">
        <Button theme="outline" disabled={loading} onClick={handleClose}>
          {t("cancel")}
        </Button>
        <Button theme="danger" disabled={loading} onClick={onConfirm}>
          {t("steam_uninstall_confirm")}
        </Button>
      </div>
    </Modal>
  );
}
