import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ImageIcon, TrashIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";
import cn from "classnames";

import { toLocalScreenshotUrl } from "@shared";
import type { LocalScreenshot } from "@types";

import type { LocalScreenshotUploadStatus } from "./use-local-screenshot-actions";

interface LocalScreenshotTileProps {
  screenshot: LocalScreenshot;
  alt: string;
  isBusy: boolean;
  uploadStatus: LocalScreenshotUploadStatus | null;
  className?: string;
  onOpen: (screenshot: LocalScreenshot) => void;
  onDelete: (screenshot: LocalScreenshot) => void;
}

export function LocalScreenshotTile({
  screenshot,
  alt,
  isBusy,
  uploadStatus,
  className,
  onOpen,
  onDelete,
}: Readonly<LocalScreenshotTileProps>) {
  const { t } = useTranslation("screenshots");
  const { t: tCapture } = useTranslation("screenshots_capture");
  const tooltipId = useId();
  const [hasFailed, setHasFailed] = useState(false);
  const deleteLabel = t("delete_screenshot");
  const isUploading = uploadStatus !== null;
  const hasUploadFailed = !isUploading && screenshot.state === "failed";
  const canDelete = !isUploading && screenshot.state !== "uploaded";

  const getUploadLabel = (status: LocalScreenshotUploadStatus) => {
    if (status.state === "queued") return tCapture("queued");
    const percent = Math.round(Math.min(Math.max(status.progress, 0), 1) * 100);
    return tCapture("uploading", { progress: percent });
  };

  return (
    <div
      className={cn("local-screenshot-tile", className, {
        "local-screenshot-tile--uploading": isUploading,
      })}
      aria-busy={isUploading}
    >
      <button
        type="button"
        className="local-screenshot-tile__media"
        onClick={() => onOpen(screenshot)}
        aria-label={alt}
        title={t("open_screenshot")}
      >
        {hasFailed ? (
          <span className="local-screenshot-tile__placeholder">
            <ImageIcon size={20} />
          </span>
        ) : (
          <img
            className="local-screenshot-tile__image"
            src={toLocalScreenshotUrl(
              screenshot.previewPath ?? screenshot.path
            )}
            alt={alt}
            loading="lazy"
            onError={() => setHasFailed(true)}
          />
        )}
      </button>

      {uploadStatus ? (
        <output className="local-screenshot-tile__upload">
          <span className="local-screenshot-tile__spinner" aria-hidden />
          <span>{getUploadLabel(uploadStatus)}</span>
        </output>
      ) : null}

      {hasUploadFailed ? (
        <span className="local-screenshot-tile__badge local-screenshot-tile__badge--error">
          {tCapture("upload_failed")}
        </span>
      ) : null}

      <div className="local-screenshot-tile__actions" hidden={!canDelete}>
        <button
          type="button"
          className="local-screenshot-tile__action local-screenshot-tile__action--danger"
          onClick={() => onDelete(screenshot)}
          disabled={isBusy || !canDelete}
          aria-label={deleteLabel}
          data-tooltip-id={tooltipId}
          data-tooltip-content={deleteLabel}
        >
          <TrashIcon size={14} />
        </button>
      </div>

      {createPortal(
        <Tooltip
          id={tooltipId}
          place="top"
          positionStrategy="fixed"
          className="local-screenshot-tile__tooltip"
        />,
        document.body
      )}
    </div>
  );
}
