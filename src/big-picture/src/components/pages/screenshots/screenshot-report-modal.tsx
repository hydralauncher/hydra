import "./screenshot-report-modal.scss";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScreenshotReportReason, ScreenshotReportValues } from "@types";
import {
  SCREENSHOT_REPORT_DESCRIPTION_MAX_LENGTH,
  normalizeScreenshotReportValues,
} from "@shared";

import {
  Button,
  DropdownSelect,
  HorizontalFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
} from "../../common";

const REGION_ID = "screenshot-report-modal";
const REASON_FOCUS_ID = "screenshot-report-reason";
const DESCRIPTION_FOCUS_ID = "screenshot-report-description";
const CANCEL_FOCUS_ID = "screenshot-report-cancel";
const SUBMIT_FOCUS_ID = "screenshot-report-submit";

interface ScreenshotReportModalProps {
  visible: boolean;
  title: string;
  reasons: ScreenshotReportReason[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: ScreenshotReportValues) => Promise<boolean>;
}

export function ScreenshotReportModal({
  visible,
  title,
  reasons,
  isSubmitting,
  onClose,
  onSubmit,
}: Readonly<ScreenshotReportModalProps>) {
  const { t } = useTranslation("big_picture");
  const defaultReason = reasons[0] ?? "other";
  const [reason, setReason] = useState<ScreenshotReportReason>(defaultReason);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!visible) return;

    setReason(defaultReason);
    setDescription("");
  }, [defaultReason, visible]);

  const submit = async () => {
    const wasAccepted = await onSubmit(
      normalizeScreenshotReportValues({ reason, description })
    );

    if (wasAccepted) onClose();
  };

  return (
    <Modal
      visible={visible}
      title={title}
      onClose={onClose}
      closeOnBackdrop={!isSubmitting}
      closeOnEscape={!isSubmitting}
      busy={isSubmitting}
      initialFocusId={REASON_FOCUS_ID}
      className="screenshot-report-modal"
      backdropClassName="screenshot-report-modal__backdrop"
    >
      <VerticalFocusGroup
        regionId={REGION_ID}
        className="screenshot-report-modal__form"
      >
        <DropdownSelect
          label={t("screenshots_report_reason")}
          value={reason}
          options={reasons.map((value) => ({
            value,
            label: t(`screenshots_report_reason_${value}`),
          }))}
          disabled={isSubmitting}
          focusId={REASON_FOCUS_ID}
          onValueChange={setReason}
        />

        <Input
          label={t("screenshots_report_description")}
          placeholder={t("screenshots_report_description_placeholder")}
          value={description}
          maxLength={SCREENSHOT_REPORT_DESCRIPTION_MAX_LENGTH}
          disabled={isSubmitting}
          focusId={DESCRIPTION_FOCUS_ID}
          onChange={(event) => setDescription(event.target.value)}
        />

        <HorizontalFocusGroup className="screenshot-report-modal__actions">
          <Button
            variant="secondary"
            focusId={CANCEL_FOCUS_ID}
            disabled={isSubmitting}
            onClick={onClose}
          >
            {t("screenshots_cancel")}
          </Button>
          <Button
            focusId={SUBMIT_FOCUS_ID}
            loading={isSubmitting}
            onClick={() => void submit()}
          >
            {t("screenshots_report_submit")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
