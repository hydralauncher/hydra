import type { CloudSaveConflictResolution } from "@types";
import { useTranslation } from "react-i18next";

import { ConfirmationModal } from "../../../modals";

interface BigPictureCloudSaveConflictModalProps {
  resolution: CloudSaveConflictResolution | null;
  isResolving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function BigPictureCloudSaveConflictModal({
  resolution,
  isResolving,
  onClose,
  onConfirm,
}: Readonly<BigPictureCloudSaveConflictModalProps>) {
  const { t } = useTranslation("game_details");
  const keepLocal = resolution === "keep-local";

  return (
    <ConfirmationModal
      visible={resolution !== null}
      title={t(
        keepLocal
          ? "cloud_save_v2_confirm_local_title"
          : "cloud_save_v2_confirm_remote_title"
      )}
      description={t(
        keepLocal
          ? "cloud_save_v2_confirm_local_description"
          : "cloud_save_v2_confirm_remote_description"
      )}
      confirmLabel={t(
        keepLocal ? "cloud_save_v2_keep_local" : "cloud_save_v2_keep_remote"
      )}
      loading={isResolving}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
