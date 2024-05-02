import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField, Modal, TextField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";

import * as styles from "./online-fix-installation-guide.css";
import { CopyIcon } from "@primer/octicons-react";
import { DONT_SHOW_ONLINE_FIX_INSTRUCTIONS_KEY } from "./constants";

const ONLINE_FIX_PASSWORD = "online-fix.me";

export interface OnlineFixInstallationGuideProps {
  visible: boolean;
  onClose: () => void;
}

export function OnlineFixInstallationGuide({
  visible,
  onClose,
}: OnlineFixInstallationGuideProps) {
  const [clipboardLocked, setClipboardLocked] = useState(false);
  const { t } = useTranslation("game_details");

  const [dontShowAgain, setDontShowAgain] = useState(true);

  const handleCopyToClipboard = () => {
    setClipboardLocked(true);

    navigator.clipboard.writeText(ONLINE_FIX_PASSWORD);

    const zero = performance.now();

    requestAnimationFrame(function holdLock(time) {
      if (time - zero <= 3000) {
        requestAnimationFrame(holdLock);
      } else {
        setClipboardLocked(false);
      }
    });
  };

  const handleClose = () => {
    if (dontShowAgain) {
      window.localStorage.setItem(DONT_SHOW_ONLINE_FIX_INSTRUCTIONS_KEY, "1");
      onClose();
    }
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
        <p style={{ fontFamily: "Fira Sans" }}>{t("online_fix_instruction")}</p>
        <div className={styles.passwordField}>
          <TextField
            value={ONLINE_FIX_PASSWORD}
            readOnly
            disabled
            style={{ fontSize: 16 }}
            textFieldProps={{ style: { height: 45 } }}
          />

          <Button
            style={{ alignSelf: "flex-end", height: 45 }}
            theme="outline"
            onClick={handleCopyToClipboard}
            disabled={clipboardLocked}
          >
            {clipboardLocked ? (
              t("copied_to_clipboard")
            ) : (
              <>
                <CopyIcon />
                {t("copy_to_clipboard")}
              </>
            )}
          </Button>
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
