import { useContext, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, CheckboxField, Modal } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";

import * as styles from "./dodi-installation-guide.css";
import { ArrowUpIcon } from "@primer/octicons-react";
import { DONT_SHOW_DODI_INSTRUCTIONS_KEY } from "./constants";
import { gameDetailsContext } from "../../game-details.context";

export interface DODIInstallationGuideProps {
  visible: boolean;
  onClose: () => void;
}

export function DODIInstallationGuide({
  visible,
  onClose,
}: DODIInstallationGuideProps) {
  const { gameColor } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");

  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleClose = () => {
    if (dontShowAgain) {
      window.localStorage.setItem(DONT_SHOW_DODI_INSTRUCTIONS_KEY, "1");
    }

    onClose();
  };

  return (
    <Modal
      title={t("installation_instructions")}
      description={t("installation_instructions_description")}
      onClose={handleClose}
      visible={visible}
    >
      <div
        style={{
          display: "flex",
          gap: SPACING_UNIT * 2,
          flexDirection: "column",
        }}
      >
        <p
          style={{ fontFamily: "Fira Sans", marginBottom: `${SPACING_UNIT}px` }}
        >
          <Trans i18nKey="dodi_installation_instruction" ns="game_details">
            <ArrowUpIcon size={16} />
          </Trans>
        </p>

        <div
          className={styles.windowContainer}
          style={{ backgroundColor: gameColor }}
        >
          <div className={styles.windowContent}>
            <ArrowUpIcon size={24} />
          </div>
        </div>

        <CheckboxField
          label={t("dont_show_it_again")}
          onChange={() => setDontShowAgain(!dontShowAgain)}
          checked={dontShowAgain}
        />

        <Button style={{ alignSelf: "flex-end" }} onClick={handleClose}>
          {t("got_it")}
        </Button>
      </div>
    </Modal>
  );
}
