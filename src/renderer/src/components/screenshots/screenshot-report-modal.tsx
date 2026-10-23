import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ContentReportModal } from "../content-report-modal/content-report-modal";
import {
  SCREENSHOT_COMMENT_REPORT_REASONS,
  SCREENSHOT_REPORT_DESCRIPTION_MAX_LENGTH,
  SCREENSHOT_REPORT_REASONS,
} from "@shared";
import type {
  ScreenshotCommentReportReason,
  ScreenshotReportReason,
  ScreenshotReportValues,
} from "@types";

interface ScreenshotReportModalProps<Reason extends ScreenshotReportReason> {
  visible: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: ScreenshotReportValues<Reason>) => Promise<boolean>;
}

export function ScreenshotReportModal({
  visible,
  isSubmitting,
  onClose,
  onSubmit,
}: Readonly<ScreenshotReportModalProps<ScreenshotReportReason>>) {
  const { t } = useTranslation("screenshots");
  const reasons = useMemo(
    () =>
      SCREENSHOT_REPORT_REASONS.map((reason) => ({
        value: reason,
        label: t(`report_reason_${reason}`),
      })),
    [t]
  );

  return (
    <ContentReportModal
      visible={visible}
      title={t("report_screenshot")}
      reasonLabel={t("report_screenshot_reason_label")}
      reasons={reasons}
      isSubmitting={isSubmitting}
      maxDescriptionLength={SCREENSHOT_REPORT_DESCRIPTION_MAX_LENGTH}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

export function ScreenshotCommentReportModal({
  visible,
  isSubmitting,
  onClose,
  onSubmit,
}: Readonly<ScreenshotReportModalProps<ScreenshotCommentReportReason>>) {
  const { t } = useTranslation("screenshots");
  const reasons = useMemo(
    () =>
      SCREENSHOT_COMMENT_REPORT_REASONS.map((reason) => ({
        value: reason,
        label: t(`report_reason_${reason}`),
      })),
    [t]
  );

  return (
    <ContentReportModal
      visible={visible}
      title={t("report_comment")}
      reasonLabel={t("report_comment_reason_label")}
      reasons={reasons}
      isSubmitting={isSubmitting}
      maxDescriptionLength={SCREENSHOT_REPORT_DESCRIPTION_MAX_LENGTH}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
