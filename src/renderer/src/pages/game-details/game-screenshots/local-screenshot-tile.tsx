import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, TrashIcon, UploadIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";
import cn from "classnames";

import { toLocalScreenshotUrl } from "@shared";
import type { LocalScreenshot } from "@types";

interface LocalScreenshotTileProps {
  screenshot: LocalScreenshot;
  alt: string;
  isBusy: boolean;
  className?: string;
  onOpen: (screenshot: LocalScreenshot) => void;
  onUpload: (screenshot: LocalScreenshot) => void;
  onDelete: (screenshot: LocalScreenshot) => void;
}

export function LocalScreenshotTile({
  screenshot,
  alt,
  isBusy,
  className,
  onOpen,
  onUpload,
  onDelete,
}: Readonly<LocalScreenshotTileProps>) {
  const { t } = useTranslation("screenshots");
  const tooltipId = useId();
  const [hasFailed, setHasFailed] = useState(false);
  const uploadLabel = t("upload_screenshot");
  const deleteLabel = t("delete_screenshot");

  return (
    <div className={cn("local-screenshot-tile", className)}>
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
            src={toLocalScreenshotUrl(screenshot.path)}
            alt={alt}
            loading="lazy"
            onError={() => setHasFailed(true)}
          />
        )}
      </button>

      <span className="local-screenshot-tile__badge">{t("not_uploaded")}</span>

      <div className="local-screenshot-tile__actions">
        <button
          type="button"
          className="local-screenshot-tile__action"
          onClick={() => onUpload(screenshot)}
          disabled={isBusy}
          aria-label={uploadLabel}
          data-tooltip-id={tooltipId}
          data-tooltip-content={uploadLabel}
        >
          <UploadIcon size={14} />
        </button>
        <button
          type="button"
          className="local-screenshot-tile__action local-screenshot-tile__action--danger"
          onClick={() => onDelete(screenshot)}
          disabled={isBusy}
          aria-label={deleteLabel}
          data-tooltip-id={tooltipId}
          data-tooltip-content={deleteLabel}
        >
          <TrashIcon size={14} />
        </button>
      </div>

      <Tooltip id={tooltipId} place="top" positionStrategy="fixed" />
    </div>
  );
}
