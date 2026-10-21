import cn from "classnames";
import { useTranslation } from "react-i18next";
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

    if (screenshot.moderationStatus === "APPROVED") {
      return { tone: "success", title: t("moderation_approved"), detail: null };
    }

    if (screenshot.moderationStatus === "BLOCKED") {
      return {
        tone: "error",
        title: t("blocked"),
        detail: t("blocked_reason", {
          reason: tModeration(
            getScreenshotModerationReasonKey(screenshot.moderationReason)
          ),
        }),
      };
    }

    return { tone: "neutral", title: t("moderation_pending"), detail: null };
  };

  if (screenshot.state === "uploading") {
    const percent = getUploadPercent(screenshot);
    const label = t("uploading", { progress: percent });

    return (
      <div className="screenshot-review-status" role="status">
        <ProgressBar
          now={percent}
          max={100}
          label={label}
          completed={false}
          trackClassName="screenshot-review-status__progress-track"
          barClassName="screenshot-review-status__progress-bar"
        />
        <p className="screenshot-review-status__title">{label}</p>
      </div>
    );
  }

  const message = getMessage();
  if (!message) return null;

  return (
    <div
      className={cn(
        "screenshot-review-status",
        `screenshot-review-status--${message.tone}`
      )}
      role="status"
    >
      <p className="screenshot-review-status__title">{message.title}</p>
      {message.detail && (
        <p className="screenshot-review-status__detail">{message.detail}</p>
      )}
    </div>
  );
}
