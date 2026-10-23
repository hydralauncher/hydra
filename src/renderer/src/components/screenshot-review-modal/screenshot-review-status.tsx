import cn from "classnames";
import { useTranslation } from "react-i18next";
import { AlertIcon, CheckCircleIcon } from "@primer/octicons-react";
import type { LocalScreenshot } from "@types";
import { ProgressBar } from "@renderer/components";
import {
  getScreenshotModerationReasonKey,
  getScreenshotUploadErrorKey,
} from "@shared";

import {
  getQueuedMessageKey,
  getUploadPercent,
} from "./screenshot-review-state";

type StatusTone = "neutral" | "success" | "error";

interface ScreenshotReviewStatusProps {
  screenshot: LocalScreenshot;
}

interface StatusMessage {
  tone: StatusTone;
  title: string;
  detail: string | null;
}

export function ScreenshotReviewStatus({
  screenshot,
}: Readonly<ScreenshotReviewStatusProps>) {
  const { t } = useTranslation("screenshots_capture");
  const { t: tModeration } = useTranslation("screenshots_moderation");
  const { t: tScreenshots } = useTranslation("screenshots");
  const titleNote =
    screenshot.textModeration?.title === "hidden"
      ? tScreenshots("title_not_allowed")
      : null;

  const getMessage = (): StatusMessage | null => {
    if (screenshot.state === "queued") {
      const detailKey = getQueuedMessageKey(screenshot.lastError);
      return {
        tone: "neutral",
        title: t("queued"),
        detail: detailKey ? t(detailKey) : null,
      };
    }

    if (screenshot.state === "failed") {
      return {
        tone: "error",
        title: t("upload_failed"),
        detail: t(getScreenshotUploadErrorKey(screenshot.lastError)),
      };
    }

    if (screenshot.state !== "uploaded") return null;

    if (screenshot.moderationStatus === "BLOCKED") {
      return {
        tone: "error",
        title: t("upload_blocked"),
        detail: tModeration(
          getScreenshotModerationReasonKey(screenshot.moderationReason)
        ),
      };
    }

    return {
      tone: "success",
      title:
        screenshot.moderationStatus === "APPROVED"
          ? t("uploaded")
          : t("uploaded_under_review"),
      detail: titleNote,
    };
  };

  if (screenshot.state === "uploading") {
    const percent = getUploadPercent(screenshot);
    const label = t("uploading", { progress: percent });

    return (
      <output className="screenshot-review-status">
        <p className="screenshot-review-status__title">{label}</p>
        <ProgressBar
          now={percent}
          max={100}
          label={label}
          completed={false}
          trackClassName="screenshot-review-status__progress-track"
          barClassName="screenshot-review-status__progress-bar"
        />
      </output>
    );
  }

  const message = getMessage();
  if (!message) return null;

  return (
    <output
      className={cn(
        "screenshot-review-status",
        `screenshot-review-status--${message.tone}`
      )}
    >
      <p className="screenshot-review-status__title">
        {message.tone === "success" && <CheckCircleIcon size={16} />}
        {message.tone === "error" && <AlertIcon size={16} />}
        {message.title}
      </p>
      {message.detail && (
        <p className="screenshot-review-status__detail">{message.detail}</p>
      )}
    </output>
  );
}
