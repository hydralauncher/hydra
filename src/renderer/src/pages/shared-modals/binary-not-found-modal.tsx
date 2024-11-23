import { useTranslation } from "react-i18next";

import { Modal } from "@renderer/components";

interface BinaryNotFoundModalProps {
  visible: boolean;
  onClose: () => void;
}

export function BinaryNotFoundModal({
  visible,
  onClose,
}: BinaryNotFoundModalProps) {
  const { t } = useTranslation("binary_not_found_modal");

  return (
    <Modal
      visible={visible}
      title={t("title")}
      description={t("description")}
      onClose={onClose}
    >
      {t("instructions")}
    </Modal>
  );
}
