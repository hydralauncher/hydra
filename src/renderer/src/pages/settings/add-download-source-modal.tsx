import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, SelectField, TextField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { settingsContext } from "@renderer/context";
import { CommunitySource } from "@types";

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

  const { t } = useTranslation("settings");

  const { sourceUrl } = useContext(settingsContext);

  const [communitySources, setCommunitySources] = useState<CommunitySource[]>([
    {
      key: "",
      value: "",
      label: "Loading...",
    },
  ]);
  const [selected, setSelected] = useState("");

  const getCommunitySources = async () => {
    return window.electron.getCommunitySources().then((sources) => {
      setCommunitySources([
        {
          key: "",
          value: "",
          label: "[select one]",
        },
        ...sources,
      ]);
    });
  };

  useEffect(() => {
    getCommunitySources();
  }, []);

  const handleValidateDownloadSource = useCallback(async (url: string) => {
    setIsLoading(true);

    try {
      const result = await window.electron.validateDownloadSource(url);
      setValidationResult(result);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelected("");
    setValue("");
    setIsLoading(false);
    setValidationResult(null);

    if (sourceUrl) {
      setValue(sourceUrl);
      handleValidateDownloadSource(sourceUrl);
    }
  }, [visible, handleValidateDownloadSource, sourceUrl]);

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
        <SelectField
          style={{
            minWidth: "500px",
          }}
          value={selected}
          label="Select a community source"
          onChange={(e) => {
            setSelected(e.target.value);
            setValue(e.target.value);
          }}
          options={communitySources}
          disabled={isLoading || communitySources.length === 0}
        />
        <div
          style={{
            width: "500px",
            display: "flex",
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            position: "relative",
            padding: "7px 0px",
          }}
        >
          <span
            style={{
              zIndex: 10,
              padding: "0px 6px",
            }}
            className="bg-background"
          >
            OR
          </span>
          <hr
            style={{
              width: "500px",
              position: "absolute",
              top: "10px",
            }}
          />
        </div>
        <TextField
          label={t("download_source_url")}
          placeholder={t("insert_valid_json_url")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rightContent={
            <Button
              type="button"
              theme="outline"
              style={{ alignSelf: "flex-end" }}
              onClick={() => handleValidateDownloadSource(value)}
              disabled={isLoading || !value}
            >
              {t("validate_download_source")}
            </Button>
          }
        />

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
                {t("found_download_option", {
                  count: validationResult?.downloadCount,
                  countFormatted:
                    validationResult?.downloadCount.toLocaleString(),
                })}
              </small>
            </div>

            <Button type="button" onClick={handleAddDownloadSource}>
              {t("import")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
