import { useTranslation } from "react-i18next";

import { ConfirmationModal } from "../../../modals";

interface BigPictureRpcs3ProfileModalProps {
  localProfileId: string | null;
  cloudProfileId: string | null;
  isBinding: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function BigPictureRpcs3ProfileModal({
  localProfileId,
  cloudProfileId,
  isBinding,
  onClose,
  onConfirm,
}: Readonly<BigPictureRpcs3ProfileModalProps>) {
  const { t } = useTranslation("game_details");

  return (
    <ConfirmationModal
      visible={cloudProfileId !== null}
      title={t("cloud_save_v2_rpcs3_profile_confirm_title")}
      description={t("cloud_save_v2_rpcs3_profile_confirm_description", {
        localProfileId,
        cloudProfileId,
      })}
      confirmLabel={t("cloud_save_v2_rpcs3_profile_confirm")}
      loading={isBinding}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
