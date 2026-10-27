import { TrashIcon, UploadIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";
import { isScreenshotUploadRetryable } from "@shared";
import { Button } from "@renderer/components";

import { isScreenshotUndecided } from "./screenshot-review-state";

interface ScreenshotReviewNextAction {
  hasNext: boolean;
  onNext: () => void;
}

interface ScreenshotReviewActionButtonsProps {
  screenshot: LocalScreenshot;
  isBusy: boolean;
  isUploading?: boolean;
  next?: ScreenshotReviewNextAction;
  onUpload: () => void;
  onRequestDelete: () => void;
}

export function ScreenshotReviewActionButtons({
  screenshot,
  isBusy,
  isUploading = false,
  next,
  onUpload,
  onRequestDelete,
}: Readonly<ScreenshotReviewActionButtonsProps>) {
  const { t } = useTranslation("screenshots_capture");

  const deleteButton = (
    <Button
      className="screenshot-review-item__delete"
      theme="danger"
      disabled={isBusy || isUploading}
      tooltip={t("delete")}
      aria-label={t("delete")}
      onClick={onRequestDelete}
    >
      <TrashIcon size={16} />
    </Button>
  );

  const renderNextButton = (theme: "primary" | "outline") =>
    next ? (
      <Button theme={theme} disabled={isBusy} onClick={next.onNext}>
        {next.hasNext ? t("next") : t("done")}
      </Button>
    ) : null;

  if (isUploading) {
    return (
      <>
        <Button className="screenshot-review-item__upload" disabled aria-busy>
          <span
            className="screenshot-review-item__upload-spinner"
            aria-hidden
          />
          {t("uploading_button")}
        </Button>
        {deleteButton}
      </>
    );
  }

  if (isScreenshotUndecided(screenshot)) {
    return (
      <>
        <Button
          className="screenshot-review-item__upload"
          disabled={isBusy}
          onClick={onUpload}
        >
          <UploadIcon size={16} />
          {t("upload")}
        </Button>
        {deleteButton}
      </>
    );
  }

  if (screenshot.state === "failed") {
    const canRetry = isScreenshotUploadRetryable(screenshot.lastError);
    return (
      <>
        {canRetry && (
          <Button theme="outline" disabled={isBusy} onClick={onUpload}>
            {t("retry")}
          </Button>
        )}
        {renderNextButton(canRetry ? "outline" : "primary")}
        {deleteButton}
      </>
    );
  }

  return renderNextButton("primary");
}
