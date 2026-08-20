import { TrashIcon } from "@phosphor-icons/react";
import type { AchievementSouvenirSyncItem } from "@types";
import { useTranslation } from "react-i18next";
import {
  Button,
  FocusItem,
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
const CLEANUP_MODAL_LIST_REGION_ID = "souvenir-sync-cleanup-list";
const CLEANUP_MODAL_ACTIONS_REGION_ID = "souvenir-sync-cleanup-actions";
const CLEANUP_MODAL_CANCEL_FOCUS_ID = "souvenir-sync-cleanup-cancel";

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
        <p className="profile-page__souvenirs-cleanup-warning">
          {t("souvenir_sync_cleanup_warning", { count: items.length })}
        </p>

        <VerticalFocusGroup
          regionId={CLEANUP_MODAL_LIST_REGION_ID}
          autoScrollMode="item"
          asChild
        >
          <ul className="profile-page__souvenirs-cleanup-list">
            {items.map((item) => {
              const achievementNames = item.achievementNames.join(", ");

              return (
                <FocusItem
                  key={item.clientId}
                  id={`souvenir-sync-cleanup-item-${item.clientId}`}
                  asChild
                >
                  <li>
                    <div className="profile-page__souvenirs-cleanup-item-header">
                      <strong>
                        {item.gameTitle ?? t("souvenir_sync_unknown_game")}
                      </strong>
                    </div>
                    <p title={achievementNames}>{achievementNames}</p>
                  </li>
                </FocusItem>
              );
            })}
          </ul>
        </VerticalFocusGroup>

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
