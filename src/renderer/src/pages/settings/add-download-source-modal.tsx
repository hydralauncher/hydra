import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useForm } from "react-hook-form";
import { logger } from "@renderer/logger";

import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
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

  const { sourceUrl } = useContext(settingsContext);

  const onSubmit = async (values: FormValues) => {
    setIsLoading(true);

    try {
      await window.electron.addDownloadSource(values.url);

      onClose();
      onAddDownloadSource();
    } catch (error) {
      logger.error("Failed to add download source:", error);
      const errorMessage =
        error instanceof Error && error.message.includes("already exists")
          ? t("download_source_already_exists")
          : t("failed_add_download_source");

      setError("url", {
        type: "server",
        message: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setValue("url", "");
    clearErrors();
    setIsLoading(false);

    if (sourceUrl) {
      setValue("url", sourceUrl);
    }
  }, [visible, clearErrors, setValue, sourceUrl]);

  const handleClose = () => {
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
        <form onSubmit={handleSubmit(onSubmit)}>
          <TextField
            {...register("url")}
            label={t("download_source_url")}
            placeholder={t("insert_valid_json_url")}
            error={errors.url?.message}
          />

          <div className="add-download-source-modal__actions">
            <Button
              type="button"
              theme="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              {t("cancel")}
            </Button>

            <Button type="submit" disabled={isSubmitting || isLoading}>
              {isLoading && (
                <SyncIcon className="add-download-source-modal__spinner" />
              )}
              {isLoading ? t("adding") : t("add_download_source")}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
