import { useTranslation } from "react-i18next";

import { ConfirmationModal } from "../confirmation-modal/confirmation-modal";

import "./neo-discord-modal.scss";

const STEPS = ["neo_discord_step_close_hydra", "neo_discord_step_logs"];

export interface NeoDiscordModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function NeoDiscordModal({
  visible,
  onClose,
  onConfirm,
}: Readonly<NeoDiscordModalProps>) {
  const { t } = useTranslation("sidebar");

  return (
    <ConfirmationModal
      visible={visible}
      title={t("neo_discord_title")}
      descriptionText={t("neo_discord_description")}
      confirmButtonLabel={t("neo_discord_confirm")}
      cancelButtonLabel={t("neo_discord_cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <div className="neo-discord-modal">
        <p className="neo-discord-modal__label">
          {t("neo_discord_before_title")}
        </p>
        <ol className="neo-discord-modal__steps">
          {STEPS.map((step, index) => (
            <li key={step} className="neo-discord-modal__step">
              <span className="neo-discord-modal__number">0{index + 1}</span>
              <span>{t(step)}</span>
            </li>
          ))}
        </ol>
        <p className="neo-discord-modal__safety">{t("neo_discord_safety")}</p>
      </div>
    </ConfirmationModal>
  );
}
