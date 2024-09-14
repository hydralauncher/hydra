import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { settingsContext } from "@renderer/context";
import { useForm } from "react-hook-form";

import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";

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
    formState: { errors },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
  });

  const [validationResult, setValidationResult] = useState<{
    name: string;
    downloadCount: number;
  } | null>(null);

  const { sourceUrl } = useContext(settingsContext);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      setIsLoading(true);

      try {
        const result = await window.electron.validateDownloadSource(values.url);
        setValidationResult(result);

        setUrl(values.url);
      } catch (error: unknown) {
        if (error instanceof Error) {
          if (
            error.message.endsWith("Source with the same url already exists")
          ) {
            setError("url", {
              type: "server",
              message: t("source_already_exists"),
            });
          }
        }
      } finally {
        setIsLoading(false);
      }
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

  const handleAddDownloadSource = async () => {
    await window.electron.addDownloadSource(url);
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
              disabled={isLoading}
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
