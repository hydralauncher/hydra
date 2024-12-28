import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { settingsContext } from "@renderer/context";
import { useForm } from "react-hook-form";

import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { downloadSourcesTable } from "@renderer/dexie";
import type { DownloadSourceValidationResult } from "@types";
import { downloadSourcesWorker } from "@renderer/workers";

interface AddDownloadSourceModalProps {
  visible: boolean;
  onClose: () => void;
  onAddDownloadSource: () => void;
}

interface FormValues {
  url: string;
}

export function AddDownloadSourceModal({
  visible,
  onClose,
  onAddDownloadSource,
}: AddDownloadSourceModalProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { t } = useTranslation("settings");

  const schema = yup.object().shape({
    url: yup.string().required(t("required_field")).url(t("must_be_valid_url")),
  });

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
  });

  const [validationResult, setValidationResult] =
    useState<DownloadSourceValidationResult | null>(null);

  const { sourceUrl } = useContext(settingsContext);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      const existingDownloadSource = await downloadSourcesTable
        .where({ url: values.url })
        .first();

      if (existingDownloadSource) {
        setError("url", {
          type: "server",
          message: t("source_already_exists"),
        });

        return;
      }

      downloadSourcesWorker.postMessage([
        "VALIDATE_DOWNLOAD_SOURCE",
        values.url,
      ]);

      const channel = new BroadcastChannel(
        `download_sources:validate:${values.url}`
      );

      channel.onmessage = (
        event: MessageEvent<DownloadSourceValidationResult>
      ) => {
        setValidationResult(event.data);
        channel.close();
      };

      setUrl(values.url);
    },
    [setError, t]
  );

  useEffect(() => {
    setValue("url", "");
    clearErrors();
    setIsLoading(false);
    setValidationResult(null);

    if (sourceUrl) {
      setValue("url", sourceUrl);
      handleSubmit(onSubmit)();
    }
  }, [visible, clearErrors, handleSubmit, onSubmit, setValue, sourceUrl]);

  const putDownloadSource = async () => {
    const downloadSource = await downloadSourcesTable.where({ url }).first();
    if (!downloadSource) return;

    window.electron
      .putDownloadSource(downloadSource.objectIds)
      .then(({ fingerprint }) => {
        downloadSourcesTable.update(downloadSource.id, { fingerprint });
      });
  };

  const handleAddDownloadSource = async () => {
    if (validationResult) {
      setIsLoading(true);

      const channel = new BroadcastChannel(`download_sources:import:${url}`);

      downloadSourcesWorker.postMessage(["IMPORT_DOWNLOAD_SOURCE", url]);

      channel.onmessage = async () => {
        setIsLoading(false);

        putDownloadSource();

        onClose();
        onAddDownloadSource();
        channel.close();
      };
    }
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
        <TextField
          {...register("url")}
          label={t("download_source_url")}
          placeholder={t("insert_valid_json_url")}
          error={errors.url}
          rightContent={
            <Button
              type="button"
              theme="outline"
              style={{ alignSelf: "flex-end" }}
              onClick={handleSubmit(onSubmit)}
              disabled={isSubmitting || isLoading}
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

            <Button
              type="button"
              onClick={handleAddDownloadSource}
              disabled={isLoading}
            >
              {t("import")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
