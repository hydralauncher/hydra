import { Button, CheckboxField, Modal } from "@renderer/components";
import { CreateSteamShortcutOptions } from "@types";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./create-steam-shortcut-modal.scss";

interface CreateSteamShortcutModalProps {
  visible: boolean;
  creating: boolean;
  onClose: () => void;
  onConfirm: (options: CreateSteamShortcutOptions) => void;
}

export function CreateSteamShortcutModal({
  visible,
  creating,
  onClose,
  onConfirm,
}: CreateSteamShortcutModalProps) {
  const { t } = useTranslation("game_details");
  const [openVr, setOpenVr] = useState(false);

  return (
    <Modal
      visible={visible}
      title={t("create_steam_shortcut")}
      onClose={onClose}
    >
      <div className="create-steam-shortcut-modal__content">
        <div className="create-steam-shortcut-modal__inputs">
          <CheckboxField
            label={t("create_steam_shortcut_modal_vr_flag")}
            checked={openVr}
            onChange={(e) => setOpenVr(e.target.checked)}
          />
        </div>
        <div className="create-steam-shortcut-modal__actions">
          <Button theme="outline" onClick={onClose}>
            {t("create_steam_shortcut_modal_cancel_button")}
          </Button>

          <Button onClick={() => onConfirm({ openVr })} disabled={creating}>
            {t("create_steam_shortcut_modal_create_button")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
