import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SouvenirReportReason, SouvenirReportValues } from "@types";

import {
  Button,
  DropdownSelect,
  HorizontalFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
} from "../../../common";

import "./report-modal.scss";

const REPORT_REASONS: SouvenirReportReason[] = [
  "hate",
  "sexual_content",
  "violence",
  "spam",
  "other",
];
const MAX_REPORT_DESCRIPTION_LENGTH = 255;
const REPORT_MODAL_REGION_ID = "souvenir-report-modal";
const REPORT_REASON_FOCUS_ID = "souvenir-report-reason";
const REPORT_DESCRIPTION_FOCUS_ID = "souvenir-report-description";
const REPORT_CANCEL_FOCUS_ID = "souvenir-report-cancel";
const REPORT_SUBMIT_FOCUS_ID = "souvenir-report-submit";

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
  const [reason, setReason] = useState<SouvenirReportReason>("hate");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!visible) return;

    setReason("hate");
    setDescription("");
  }, [visible]);

  const submitReport = async () => {
    const wasAccepted = await onSubmit({ reason, description });
    if (wasAccepted) onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("report_souvenir")}
      onClose={onClose}
      closeOnBackdrop={!isSubmitting}
      closeOnEscape={!isSubmitting}
      closeOnB={!isSubmitting}
      initialFocusId={REPORT_REASON_FOCUS_ID}
      className="big-picture-souvenir-report-modal"
      backdropClassName="big-picture-souvenir-report-modal__backdrop"
    >
      <VerticalFocusGroup
        regionId={REPORT_MODAL_REGION_ID}
        className="big-picture-souvenir-report-modal__form"
      >
        <DropdownSelect
          label={t("report_souvenir_reason_label")}
          value={reason}
          options={REPORT_REASONS.map((reportReason) => ({
            value: reportReason,
            label: t(`report_reason_${reportReason}`),
          }))}
          disabled={isSubmitting}
          focusId={REPORT_REASON_FOCUS_ID}
          onValueChange={setReason}
        />

        <Input
          label={t("report_description_optional")}
          placeholder={t("report_description_placeholder")}
          value={description}
          maxLength={MAX_REPORT_DESCRIPTION_LENGTH}
          disabled={isSubmitting}
          focusId={REPORT_DESCRIPTION_FOCUS_ID}
          onChange={(event) => setDescription(event.target.value)}
        />

        <HorizontalFocusGroup className="big-picture-souvenir-report-modal__actions">
          <Button
            variant="secondary"
            focusId={REPORT_CANCEL_FOCUS_ID}
            disabled={isSubmitting}
            onClick={onClose}
          >
            {t("delete_souvenir_modal_cancel_button")}
          </Button>
          <Button
            focusId={REPORT_SUBMIT_FOCUS_ID}
            loading={isSubmitting}
            onClick={() => void submitReport()}
          >
            {t("report")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
