import { ContentReportModal } from "@renderer/components";
import type { SouvenirReportReason, SouvenirReportValues } from "@types";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const REPORT_REASONS: SouvenirReportReason[] = [
  "hate",
  "sexual_content",
  "violence",
  "spam",
  "other",
];

interface SouvenirReportModalProps {
  visible: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: SouvenirReportValues) => Promise<boolean>;
}

export function SouvenirReportModal({
  visible,
  isSubmitting,
  onClose,
  onSubmit,
}: Readonly<SouvenirReportModalProps>) {
  const { t } = useTranslation("user_profile");
  const reasons = useMemo(
    () =>
      REPORT_REASONS.map((reason) => ({
        value: reason,
        label: t(`report_reason_${reason}`),
      })),
    [t]
  );

  return (
    <ContentReportModal
      visible={visible}
      title={t("report_souvenir")}
      reasonLabel={t("report_souvenir_reason_label")}
      reasons={reasons}
      isSubmitting={isSubmitting}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
