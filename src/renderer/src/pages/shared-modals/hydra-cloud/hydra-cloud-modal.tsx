import { Button, Modal } from "@renderer/components";
import { useTranslation } from "react-i18next";
import "./hydra-cloud-modal.scss";

export interface HydraCloudModalProps {
  feature: string;
  visible: boolean;
  onClose: () => void;
}

export const HydraCloudModal = ({
  feature,
  visible,
  onClose,
}: HydraCloudModalProps) => {
  const { t } = useTranslation("hydra_cloud");

  const handleClickOpenCheckout = () => {
    window.electron.openCheckout();
  };

  return (
    <Modal visible={visible} title={t("hydra_cloud")} onClose={onClose}>
      <div
        className="hydra-cloud-modal__container"
        data-hydra-cloud-feature={feature}
      >
        {t("hydra_cloud_feature_found")}
        <Button onClick={handleClickOpenCheckout}>{t("learn_more")}</Button>
      </div>
    </Modal>
  );
};
