import { Modal } from "@renderer/components"
import { useTranslation } from "react-i18next";

interface BinaryNotFoundModalProps {
  visible: boolean;
  onClose: () => void;
}

export const BinaryNotFoundModal = ({
  visible,
  onClose
}: BinaryNotFoundModalProps) => {
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
  )
}