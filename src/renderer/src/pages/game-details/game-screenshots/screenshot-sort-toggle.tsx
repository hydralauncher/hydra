import { useTranslation } from "react-i18next";
import { FlameIcon, HistoryIcon } from "@primer/octicons-react";

import { ScreenshotSegmentedToggle } from "@renderer/components/screenshots/screenshot-segmented-toggle";
import type { ScreenshotSort } from "@types";

interface ScreenshotSortToggleProps {
  sort: ScreenshotSort;
  onChange: (sort: ScreenshotSort) => void;
}

export function ScreenshotSortToggle({
  sort,
  onChange,
}: Readonly<ScreenshotSortToggleProps>) {
  const { t } = useTranslation("screenshots");

  return (
    <ScreenshotSegmentedToggle
      label={t("sort_by")}
      value={sort}
      options={[
        { value: "recent", label: t("sort_recent"), icon: HistoryIcon },
        { value: "top", label: t("sort_top"), icon: FlameIcon },
      ]}
      onChange={onChange}
    />
  );
}
