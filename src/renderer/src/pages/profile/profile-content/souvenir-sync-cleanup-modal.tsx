import { TrashIcon } from "@primer/octicons-react";
import type { AchievementSouvenirSyncItem } from "@types";
import { Button, Modal } from "@renderer/components";
import { useTranslation } from "react-i18next";
import { SouvenirSyncPreview } from "../../../../../shared/souvenir-sync-preview";

interface SouvenirSyncCleanupModalProps {
  visible: boolean;
  items: AchievementSouvenirSyncItem[];
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function SouvenirSyncCleanupModal({
  visible,
  items,
  isDeleting,
  onClose,
  onConfirm,
}: Readonly<SouvenirSyncCleanupModalProps>) {
  const { t } = useTranslation("settings");

  return (
    <Modal
      visible={visible}
      title={t("souvenir_sync_cleanup_title")}
      onClose={onClose}
      clickOutsideToClose={!isDeleting}
      large
    >
      <div className="profile-content__souvenirs-cleanup-modal">
        <p className="profile-content__souvenirs-cleanup-warning">
          {t("souvenir_sync_cleanup_warning", { count: items.length })}
        </p>

        <ul className="profile-content__souvenirs-cleanup-list">
          {items.map((item) => (
            <li key={item.clientId}>
              <SouvenirSyncPreview item={item} />
            </li>
          ))}
        </ul>

        <div className="profile-content__souvenirs-cleanup-actions">
          <Button theme="outline" disabled={isDeleting} onClick={onClose}>
            {t("souvenir_sync_cleanup_cancel")}
          </Button>
          <Button theme="danger" disabled={isDeleting} onClick={onConfirm}>
            <TrashIcon size={14} />
            {t("souvenir_sync_cleanup_confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
