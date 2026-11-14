import { useTranslation } from "react-i18next";

import { Modal } from "@renderer/components/modal/modal";
import { GameDetailsContextProvider } from "@renderer/context";
import { RomSourcesPanel } from "./rom-source-list";
import "@renderer/components/setup-modal/setup-modal.scss";
import "./recompilation-install-modal.scss";

interface RomDownloadModalProps {
  visible: boolean;
  objectId: string;
  gameTitle: string;
  onStarted: () => void;
  onClose: () => void;
}

export function RomDownloadModal({
  visible,
  objectId,
  gameTitle,
  onStarted,
  onClose,
}: Readonly<RomDownloadModalProps>) {
  const { t } = useTranslation("recompilation");

  return (
    <Modal
      visible={visible}
      title={
        <div className="setup-modal__header">
          <h2 className="setup-modal__header-title">
            {t("rom_choice_download")}
          </h2>
        </div>
      }
      onClose={onClose}
    >
      {visible && (
        <GameDetailsContextProvider
          objectId={objectId}
          gameTitle={gameTitle}
          shop="launchbox"
          syncHeaderTitle={false}
        >
          <div className="setup-modal recompilation-install">
            <div className="setup-modal__body">
              <RomSourcesPanel
                objectId={objectId}
                gameTitle={gameTitle}
                onStarted={onStarted}
              />
            </div>
          </div>
        </GameDetailsContextProvider>
      )}
    </Modal>
  );
}
