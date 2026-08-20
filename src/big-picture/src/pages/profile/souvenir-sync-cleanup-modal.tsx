import { TrashIcon } from "@phosphor-icons/react";
import type { AchievementSouvenirSyncItem } from "@types";
import { useTranslation } from "react-i18next";
import {
  Button,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../components";

interface SouvenirSyncCleanupModalProps {
  visible: boolean;
  items: AchievementSouvenirSyncItem[];
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const CLEANUP_MODAL_REGION_ID = "souvenir-sync-cleanup-modal";
const CLEANUP_MODAL_ACTIONS_REGION_ID = "souvenir-sync-cleanup-actions";
const CLEANUP_MODAL_CANCEL_FOCUS_ID = "souvenir-sync-cleanup-cancel";

const getFileName = (filePath: string) =>
  filePath.split(/[\\/]/).at(-1) ?? filePath;

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
      closeOnBackdrop={!isDeleting}
      closeOnEscape={!isDeleting}
      closeOnB={!isDeleting}
      initialFocusId={CLEANUP_MODAL_CANCEL_FOCUS_ID}
      className="profile-page__souvenirs-cleanup-modal"
    >
      <VerticalFocusGroup
        regionId={CLEANUP_MODAL_REGION_ID}
        className="profile-page__souvenirs-cleanup-content"
      >
        <p>{t("souvenir_sync_cleanup_description", { count: items.length })}</p>

        <ul className="profile-page__souvenirs-cleanup-list">
          {items.map((item) => (
            <li key={item.clientId}>
              <div className="profile-page__souvenirs-cleanup-item-header">
                <strong>
                  {item.gameTitle ?? t("souvenir_sync_unknown_game")}
                </strong>
                <span>{t(`souvenir_sync_item_${item.status}`)}</span>
              </div>
              <p>{item.achievementNames.join(", ")}</p>
              <code title={item.screenshotPath}>
                {getFileName(item.screenshotPath)}
              </code>
            </li>
          ))}
        </ul>

        <p className="profile-page__souvenirs-cleanup-warning">
          {t("souvenir_sync_cleanup_warning")}
        </p>

        <HorizontalFocusGroup
          regionId={CLEANUP_MODAL_ACTIONS_REGION_ID}
          className="profile-page__souvenirs-cleanup-actions"
        >
          <Button
            variant="secondary"
            focusId={CLEANUP_MODAL_CANCEL_FOCUS_ID}
            disabled={isDeleting}
            onClick={onClose}
          >
            {t("souvenir_sync_cleanup_cancel")}
          </Button>
          <Button
            variant="danger"
            loading={isDeleting}
            icon={<TrashIcon size={18} />}
            onClick={onConfirm}
          >
            {t("souvenir_sync_cleanup_confirm")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
