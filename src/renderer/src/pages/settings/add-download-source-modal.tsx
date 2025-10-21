import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useForm } from "react-hook-form";
import { useAppDispatch } from "@renderer/hooks";

import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import type { DownloadSourceValidationResult } from "@types";
import { setIsImportingSources } from "@renderer/features";
import { SyncIcon } from "@primer/octicons-react";
import "./add-download-source-modal.scss";

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
}: Readonly<AddDownloadSourceModalProps>) {
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

  const dispatch = useAppDispatch();

  const onSubmit = useCallback(
    async (values: FormValues) => {
      const exists = await window.electron.checkDownloadSourceExists(
        values.url
      );

      if (exists) {
        setError("url", {
          type: "server",
          message: t("source_already_exists"),
        });

        return;
      }

      const validationResult = await window.electron.validateDownloadSource(
        values.url
      );

      setValidationResult(validationResult);
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

  const handleAddDownloadSource = async () => {
    if (validationResult) {
      setIsLoading(true);
      dispatch(setIsImportingSources(true));

      try {
        // Single call that handles: import → API sync → fingerprint
        await window.electron.addDownloadSource(url);

        // Close modal and update UI
        onClose();
        onAddDownloadSource();
      } catch (error) {
        console.error("Failed to add download source:", error);
        setError("url", {
          type: "server",
          message: "Failed to import source. Please try again.",
        });
      } finally {
        setIsLoading(false);
        dispatch(setIsImportingSources(false));
      }
    }
  };

  const handleClose = () => {
    // Prevent closing while importing
    if (isLoading) return;
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("add_download_source")}
      description={t("add_download_source_description")}
      onClose={handleClose}
      clickOutsideToClose={!isLoading}
    >
      <div className="add-download-source-modal__container">
        <TextField
          {...register("url")}
          label={t("download_source_url")}
          placeholder={t("insert_valid_json_url")}
          error={errors.url?.message}
          rightContent={
            <Button
              type="button"
              theme="outline"
              className="add-download-source-modal__validate-button"
              onClick={handleSubmit(onSubmit)}
              disabled={isSubmitting || isLoading}
            >
              {t("validate_download_source")}
            </Button>
          }
        />

        {validationResult && (
          <div className="add-download-source-modal__validation-result">
            <div className="add-download-source-modal__validation-info">
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
              {isLoading && (
                <SyncIcon className="add-download-source-modal__spinner" />
              )}
              {isLoading ? t("importing") : t("import")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
