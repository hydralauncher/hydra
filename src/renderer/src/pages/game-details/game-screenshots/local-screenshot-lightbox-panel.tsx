import { useTranslation } from "react-i18next";

import { ScreenshotReviewActionButtons } from "@renderer/components/screenshot-review-modal/screenshot-review-action-buttons";
import { ScreenshotReviewFields } from "@renderer/components/screenshot-review-modal/screenshot-review-fields";
import type { ScreenshotReviewDraft } from "@renderer/components/screenshot-review-modal/screenshot-review-state";
import { ScreenshotReviewStatus } from "@renderer/components/screenshot-review-modal/screenshot-review-status";
import { useScreenshotReviewActions } from "@renderer/components/screenshot-review-modal/use-screenshot-review-actions";
import { useDate } from "@renderer/hooks";
import { getLocalScreenshotTitle } from "@shared";
import type { LocalScreenshot } from "@types";

interface LocalScreenshotLightboxPanelProps {
  screenshot: LocalScreenshot;
  draft: ScreenshotReviewDraft;
  onDraftChange: (draft: ScreenshotReviewDraft) => void;
  onDraftCommit: () => void;
}

export function LocalScreenshotLightboxPanel({
  screenshot,
  draft,
  onDraftChange,
  onDraftCommit,
}: Readonly<LocalScreenshotLightboxPanelProps>) {
  const { t } = useTranslation("screenshots_capture");
  const { formatDateTime } = useDate();
  const { isBusy, upload, requestDelete, elements } =
    useScreenshotReviewActions(screenshot, draft);

  const handleUpload = () => {
    onDraftCommit();
    void upload();
  };

  return (
    <aside className="screenshot-lightbox__panel local-screenshot-panel">
      <header className="screenshot-lightbox__info">
        <p className="screenshot-lightbox__byline">
          <span className="screenshot-lightbox__game">
            {getLocalScreenshotTitle(screenshot)}
          </span>
          <span className="screenshot-lightbox__separator" aria-hidden="true">
            ·
          </span>
          <time
            className="screenshot-lightbox__date"
            dateTime={new Date(screenshot.capturedAt).toISOString()}
          >
            {formatDateTime(screenshot.capturedAt)}
          </time>
        </p>
        <span className="local-screenshot-panel__badge">
          {t("not_uploaded")}
        </span>
      </header>

      <ScreenshotReviewStatus screenshot={screenshot} />

      <div className="local-screenshot-panel__fields">
        <ScreenshotReviewFields
          screenshot={screenshot}
          draft={draft}
          isBusy={isBusy}
          onDraftChange={onDraftChange}
          onDraftCommit={onDraftCommit}
        />
      </div>

      <div className="local-screenshot-panel__actions">
        <ScreenshotReviewActionButtons
          screenshot={screenshot}
          isBusy={isBusy}
          onUpload={handleUpload}
          onRequestDelete={requestDelete}
        />
      </div>

      {elements}
    </aside>
  );
}
