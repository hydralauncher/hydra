import { Button, Modal } from "@renderer/components";
import { useTranslation } from "react-i18next";

import "./select-executable-action-modal.scss";

export interface SelectExecutableActionModalProps {
  visible: boolean;
  fileName: string;
  onClose: () => void;
  onSetAsGameExecutable: () => void;
  onRunAsInstaller: () => void;
}

export function SelectExecutableActionModal({
  visible,
  fileName,
  onClose,
  onSetAsGameExecutable,
  onRunAsInstaller,
}: SelectExecutableActionModalProps) {
  const { t } = useTranslation("downloads");

  return (
    <Modal
      visible={visible}
      title={t("select_executable_action_title")}
      onClose={onClose}
    >
      <div className="select-executable-action-modal">
        <p className="select-executable-action-modal__description">
          {t("select_executable_action_description", { fileName })}
        </p>

        <div className="select-executable-action-modal__actions">
          <Button theme="outline" onClick={onRunAsInstaller}>
            {t("run_as_installer")}
          </Button>
          <Button theme="primary" onClick={onSetAsGameExecutable}>
            {t("set_as_game_executable")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
