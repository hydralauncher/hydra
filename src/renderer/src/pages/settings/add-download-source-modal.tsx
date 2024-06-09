import { Button, Modal, TextField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-download-sources.css";

interface AddDownloadSourceModalProps {
  visible: boolean;
  onClose: () => void;
  onAddDownloadSource: () => void;
}

export function AddDownloadSourceModal({
  visible,
  onClose,
  onAddDownloadSource,
}: AddDownloadSourceModalProps) {
  const [value, setValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [validationResult, setValidationResult] = useState<{
    name: string;
    downloadCount: number;
  } | null>(null);

  useEffect(() => {
    setValue("");
    setIsLoading(false);
    setValidationResult(null);
  }, [visible]);

  const { t } = useTranslation("settings");

  const handleValidateDownloadSource = async () => {
    setIsLoading(true);

    try {
      const result = await window.electron.validateDownloadSource(value);
      setValidationResult(result);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddDownloadSource = async () => {
    await window.electron.addDownloadSource(value);
    onClose();
    onAddDownloadSource();
  };

  return (
    <Modal
      visible={visible}
      title={t("add_download_source")}
      description={t("add_download_source_description")}
      onClose={onClose}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: `${SPACING_UNIT}px`,
          minWidth: "500px",
        }}
      >
        <div className={styles.downloadSourceField}>
          <TextField
            label={t("download_source_url")}
            placeholder="Insert a valid JSON url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />

          <Button
            type="button"
            theme="outline"
            style={{ alignSelf: "flex-end" }}
            onClick={handleValidateDownloadSource}
            disabled={isLoading || !value}
          >
            {t("validate_download_source")}
          </Button>
        </div>

        {validationResult && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: `${SPACING_UNIT * 3}px`,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: `${SPACING_UNIT / 2}px`,
              }}
            >
              <h4>{validationResult?.name}</h4>
              <small>
                Found{" "}
                {validationResult?.downloadCount.toLocaleString(undefined)}{" "}
                download options
              </small>
            </div>

            <Button type="button" onClick={handleAddDownloadSource}>
              Import
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
