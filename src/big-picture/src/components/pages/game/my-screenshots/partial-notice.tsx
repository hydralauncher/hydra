import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../common";
import type { FocusOverrides } from "../../../../services";
import type { MyGameScreenshots } from "./use-my-game-screenshots";

interface MyScreenshotsPartialNoticeProps {
  mine: MyGameScreenshots;
  focusId: string;
  className: string;
  navigationOverrides?: FocusOverrides;
  navigationOrder?: number;
}

export function MyScreenshotsPartialNotice({
  mine,
  focusId,
  className,
  navigationOverrides,
  navigationOrder,
}: Readonly<MyScreenshotsPartialNoticeProps>) {
  const { t } = useTranslation("screenshots");

  if (!mine.isPartial) return null;

  return (
    <output className={className}>
      <span>
        {t(
          mine.hasLocalFailed
            ? "local_screenshots_load_failed"
            : "published_screenshots_load_failed"
        )}
      </span>
      <Button
        variant="secondary"
        size="small"
        focusId={focusId}
        icon={<ArrowClockwiseIcon size={18} />}
        focusNavigationOverrides={navigationOverrides}
        focusNavigationOrder={navigationOrder}
        onClick={mine.retryFailed}
      >
        {t("screenshots_retry", { ns: "big_picture" })}
      </Button>
    </output>
  );
}
