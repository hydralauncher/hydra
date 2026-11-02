import { useTranslation } from "react-i18next";
import { AlertIcon } from "@primer/octicons-react";

interface MyScreenshotsPartialNoticeProps {
  hasLocalFailed: boolean;
  onRetry: () => void;
}

export function MyScreenshotsPartialNotice({
  hasLocalFailed,
  onRetry,
}: Readonly<MyScreenshotsPartialNoticeProps>) {
  const { t } = useTranslation("screenshots");

  return (
    <output className="my-screenshots-partial-notice">
      <AlertIcon size={14} />
      <span>
        {t(
          hasLocalFailed
            ? "local_screenshots_load_failed"
            : "published_screenshots_load_failed"
        )}
      </span>
      <button
        type="button"
        className="my-screenshots-partial-notice__retry"
        onClick={onRetry}
      >
        {t("retry")}
      </button>
    </output>
  );
}
