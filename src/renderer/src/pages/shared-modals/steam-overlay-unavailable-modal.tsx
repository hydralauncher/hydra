import { useTranslation } from "react-i18next";

import { ConfirmationModal } from "@renderer/components";

interface SteamOverlayUnavailableModalProps {
  visible: boolean;
  onClose: () => void;
  onRunAnyway: () => void;
}

export function SteamOverlayUnavailableModal({
  visible,
  onClose,
  onRunAnyway,
}: Readonly<SteamOverlayUnavailableModalProps>) {
  const { t } = useTranslation("game_details");

  return (
    <ConfirmationModal
      visible={visible}
      title={t("steam_overlay_unavailable_title")}
      descriptionText={t("steam_overlay_unavailable_description")}
      cancelButtonLabel={t("close")}
      confirmButtonLabel={t("steam_overlay_run_anyway")}
      confirmButtonTheme="danger"
      onCancel={onClose}
      onConfirm={onRunAnyway}
      onClose={onClose}
    />
  );
}
