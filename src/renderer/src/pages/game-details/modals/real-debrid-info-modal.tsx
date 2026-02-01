import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Link, Modal } from "@renderer/components";
import { ExportSquare } from "iconsax-reactjs";
import "./real-debrid-info-modal.scss";

const realDebridReferralId = import.meta.env
  .RENDERER_VITE_REAL_DEBRID_REFERRAL_ID;

const REAL_DEBRID_URL = realDebridReferralId
  ? `https://real-debrid.com/?id=${realDebridReferralId}`
  : "https://real-debrid.com";

export interface RealDebridInfoModalProps {
  visible: boolean;
  onClose: () => void;
}

export function RealDebridInfoModal({
  visible,
  onClose,
}: Readonly<RealDebridInfoModalProps>) {
  const { t } = useTranslation("game_details");
  const { t: tSettings } = useTranslation("settings");
  const navigate = useNavigate();

  return (
    <Modal
      visible={visible}
      title={tSettings("enable_real_debrid")}
      onClose={onClose}
    >
      <div className="real-debrid-info-modal__content">
        <div className="real-debrid-info-modal__description-container">
          <p className="real-debrid-info-modal__description">
            {tSettings("real_debrid_description")}
          </p>
          <Link
            to={REAL_DEBRID_URL}
            className="real-debrid-info-modal__create-account"
          >
            <ExportSquare variant="Linear" />
            {tSettings("create_real_debrid_account")}
          </Link>
        </div>

        <Button
          onClick={() => {
            onClose();
            navigate("/settings?tab=4");
          }}
        >
          {t("go_to_settings")}
        </Button>
      </div>
    </Modal>
  );
}
