import { useTranslation } from "react-i18next";

import { Button } from "../button/button";

interface ScreenshotLoadMoreErrorProps {
  onRetry: () => void;
}

export function ScreenshotLoadMoreError({
  onRetry,
}: Readonly<ScreenshotLoadMoreErrorProps>) {
  const { t } = useTranslation("screenshots");

  return (
    <output className="screenshot-load-more-error">
      <span>{t("load_more_failed")}</span>
      <Button theme="outline" onClick={onRetry}>
        {t("retry")}
      </Button>
    </output>
  );
}
