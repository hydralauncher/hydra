import { Button, Modal } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useTranslation } from "react-i18next";

export interface HydraCloudModalProps {
  visible: boolean;
  onClose: () => void;
}

export const HydraCloudModal = ({ visible, onClose }: HydraCloudModalProps) => {
  const { t } = useTranslation("hydra_cloud");

  const handleClickOpenCheckout = () => {
    window.electron.openCheckout();
  };

  return (
    <Modal visible={visible} title={t("hydra_cloud")} onClose={onClose}>
      <div
        style={{
          display: "flex",
          width: "500px",
          flexDirection: "column",
          gap: `${SPACING_UNIT * 2}px`,
        }}
      >
        {t("hydra_cloud_feature_found")}
        <Button onClick={handleClickOpenCheckout}>Saiba mais</Button>
      </div>
    </Modal>
  );
};
