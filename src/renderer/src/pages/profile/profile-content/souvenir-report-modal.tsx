import { yupResolver } from "@hookform/resolvers/yup";
import { Button, Modal, SelectField, TextField } from "@renderer/components";
import type { SouvenirReportReason, SouvenirReportValues } from "@types";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as yup from "yup";

import "./souvenir-report-modal.scss";

const REPORT_REASONS: SouvenirReportReason[] = [
  "hate",
  "sexual_content",
  "violence",
  "spam",
  "other",
];
const MAX_REPORT_DESCRIPTION_LENGTH = 255;

interface SouvenirReportModalProps {
  visible: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: SouvenirReportValues) => Promise<boolean>;
}

interface FormValues {
  reason: SouvenirReportReason;
  description: string;
}

export function SouvenirReportModal({
  visible,
  isSubmitting,
  onClose,
  onSubmit,
}: Readonly<SouvenirReportModalProps>) {
  const { t } = useTranslation(["user_profile", "game_details"]);
  const schema = yup.object({
    reason: yup
      .mixed<SouvenirReportReason>()
      .oneOf(REPORT_REASONS)
      .required(t("required_field")),
    description: yup
      .string()
      .trim()
      .max(
        MAX_REPORT_DESCRIPTION_LENGTH,
        t("max_length_field", {
          ns: "game_details",
          length: MAX_REPORT_DESCRIPTION_LENGTH,
        })
      )
      .defined(),
  });
  const {
    control,
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { reason: "hate", description: "" },
  });

  useEffect(() => {
    if (visible) reset({ reason: "hate", description: "" });
  }, [reset, visible]);

  const submitReport = handleSubmit(async (values) => {
    const wasAccepted = await onSubmit(values);
    if (wasAccepted) onClose();
  });

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={t("report_souvenir")}
      clickOutsideToClose={!isSubmitting}
    >
      <form className="souvenir-report-modal__form" onSubmit={submitReport}>
        <Controller
          control={control}
          name="reason"
          render={({ field }) => (
            <SelectField
              label={t("report_souvenir_reason_label")}
              value={field.value}
              disabled={isSubmitting}
              onChange={field.onChange}
              options={REPORT_REASONS.map((reason) => ({
                key: reason,
                value: reason,
                label: t(`report_reason_${reason}`),
              }))}
            />
          )}
        />

        <TextField
          {...register("description")}
          label={t("report_description_optional")}
          placeholder={t("report_description_placeholder")}
          maxLength={MAX_REPORT_DESCRIPTION_LENGTH}
          disabled={isSubmitting}
          error={errors.description?.message}
        />

        <Button
          type="submit"
          className="souvenir-report-modal__submit"
          disabled={isSubmitting}
        >
          {t("report")}
        </Button>
      </form>
    </Modal>
  );
}
