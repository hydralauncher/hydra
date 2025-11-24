import { useContext, useEffect, useMemo, useState } from "react";
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
  url?: string;
  urls?: string;
}

export function AddDownloadSourceModal({
  visible,
  onClose,
  onAddDownloadSource,
}: Readonly<AddDownloadSourceModalProps>) {
  const [isLoading, setIsLoading] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkResults, setBulkResults] = useState<{
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);

  const { t } = useTranslation("settings");

  const schema = useMemo(
    () =>
      yup.object().shape({
        url: isBulkMode
          ? yup.string()
          : yup
              .string()
              .required(t("required_field"))
              .url(t("must_be_valid_url")),
        urls: isBulkMode
          ? yup
              .string()
              .required(t("required_field"))
              .test("valid-urls", t("must_be_valid_urls"), (value) => {
                if (!value) return false;
                const urlList = value
                  .split("\n")
                  .map((url) => url.trim())
                  .filter((url) => url.length > 0);
                if (urlList.length === 0) return false;
                try {
                  for (const url of urlList) {
                    new URL(url);
                  }
                  return true;
                } catch {
                  return false;
                }
              })
          : yup.string(),
      }),
    [isBulkMode, t]
  );

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: yupResolver(schema) as any,
  });

  const watchedUrls = watch("urls");

  const { sourceUrl } = useContext(settingsContext);

  const onSubmit = async (values: FormValues) => {
    setIsLoading(true);
    setBulkResults(null);

    try {
      if (isBulkMode) {
        const urlList = (values.urls || "")
          .split("\n")
          .map((url) => url.trim())
          .filter((url) => url.length > 0);

        const results =
          await globalThis.electron.addDownloadSourcesBulk(urlList);

        setBulkResults({
          success: results.success,
          failed: results.failed,
          errors: results.errors,
        });

        if (results.success > 0) {
          onAddDownloadSource();
        }

        if (results.failed === 0) {
          setTimeout(() => {
            onClose();
          }, 2000);
        }
      } else {
        if (!values.url) {
          setIsLoading(false);
          return;
        }
        await window.electron.addDownloadSource(values.url);
        onClose();
        onAddDownloadSource();
      }
    } catch (error) {
      logger.error("Failed to add download source:", error);
      const errorMessage =
        error instanceof Error && error.message.includes("already exists")
          ? t("download_source_already_exists")
          : t("failed_add_download_source");

      if (isBulkMode) {
        setError("urls", {
          type: "server",
          message: errorMessage,
        });
      } else {
        setError("url", {
          type: "server",
          message: errorMessage,
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setValue("url", "");
      setValue("urls", "");
      clearErrors();
      setIsLoading(false);
      setBulkResults(null);
      setIsBulkMode(false);

      if (sourceUrl) {
        setValue("url", sourceUrl);
      }
    }
  }, [visible, clearErrors, setValue, sourceUrl]);

  const handleClose = () => {
    if (isLoading) return;
    onClose();
  };

  const urlCount = isBulkMode
    ? ((watchedUrls || "")
        .split("\n")
        .map((url) => url.trim())
        .filter((url) => url.length > 0).length ?? 0)
    : 0;

  return (
    <Modal
      visible={visible}
      title={t("add_download_source")}
      description={t("add_download_source_description")}
      onClose={handleClose}
      clickOutsideToClose={!isLoading}
    >
      <div className="add-download-source-modal__container">
        <div className="add-download-source-modal__mode-toggle">
          <Button
            type="button"
            theme={isBulkMode ? "outline" : "primary"}
            onClick={() => {
              setIsBulkMode(false);
              setBulkResults(null);
              clearErrors();
            }}
            disabled={isLoading}
          >
            {t("single_source")}
          </Button>
          <Button
            type="button"
            theme={isBulkMode ? "primary" : "outline"}
            onClick={() => {
              setIsBulkMode(true);
              setBulkResults(null);
              clearErrors();
            }}
            disabled={isLoading}
          >
            {t("bulk_add_sources")}
          </Button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          {isBulkMode ? (
            <div className="add-download-source-modal__textarea-container">
              <label htmlFor="bulk-urls">
                {t("download_source_urls")} {urlCount > 0 && `(${urlCount})`}
              </label>
              <textarea
                {...register("urls")}
                id="bulk-urls"
                className="add-download-source-modal__textarea"
                placeholder={t("insert_urls_one_per_line")}
                rows={10}
              />
              {errors.urls?.message && (
                <small className="add-download-source-modal__error">
                  {errors.urls.message}
                </small>
              )}
            </div>
          ) : (
            <TextField
              {...register("url")}
              label={t("download_source_url")}
              placeholder={t("insert_valid_json_url")}
              error={errors.url?.message}
            />
          )}

          {bulkResults && (
            <div className="add-download-source-modal__results">
              <p>
                {t("bulk_add_results", {
                  success: bulkResults.success,
                  failed: bulkResults.failed,
                })}
              </p>
              {bulkResults.errors.length > 0 && (
                <div className="add-download-source-modal__errors">
                  {bulkResults.errors.map((error) => (
                    <small
                      key={error}
                      className="add-download-source-modal__error"
                    >
                      {error}
                    </small>
                  ))}
                </div>
              )}
            </div>
          )}

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
              {(() => {
                if (isLoading) return t("adding");
                return isBulkMode
                  ? t("add_download_sources")
                  : t("add_download_source");
              })()}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
