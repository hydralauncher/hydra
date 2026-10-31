import { yupResolver } from "@hookform/resolvers/yup";
import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as yup from "yup";

import { Button } from "../button/button";
import { Modal } from "../modal/modal";
import { SelectField } from "../select-field/select-field";
import { TextField } from "../text-field/text-field";

import "./content-report-modal.scss";

const DEFAULT_MAX_DESCRIPTION_LENGTH = 255;

export interface ContentReportReasonOption<Reason extends string> {
  value: Reason;
  label: string;
}

export interface ContentReportValues<Reason extends string> {
  reason: Reason;
  description: string;
}

interface FormValues {
  reason: string;
  description: string;
}

export interface ContentReportModalProps<Reason extends string> {
  visible: boolean;
  title: string;
  reasonLabel: string;
  reasons: ContentReportReasonOption<Reason>[];
  isSubmitting: boolean;
  maxDescriptionLength?: number;
  onClose: () => void;
  onSubmit: (values: ContentReportValues<Reason>) => Promise<boolean>;
}

export function ContentReportModal<Reason extends string>({
  visible,
  title,
  reasonLabel,
  reasons,
  isSubmitting,
  maxDescriptionLength = DEFAULT_MAX_DESCRIPTION_LENGTH,
  onClose,
  onSubmit,
}: Readonly<ContentReportModalProps<Reason>>) {
  const { t } = useTranslation(["user_profile", "game_details"]);
  const reasonValues = useMemo<string[]>(
    () => reasons.map((reason) => reason.value),
    [reasons]
  );
  const defaultReason = reasonValues[0];
  const schema = yup.object({
    reason: yup.string().oneOf(reasonValues).required(t("required_field")),
    description: yup
      .string()
      .trim()
      .max(
        maxDescriptionLength,
        t("max_length_field", {
          ns: "game_details",
          length: maxDescriptionLength,
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
    defaultValues: { reason: defaultReason, description: "" },
  });

  useEffect(() => {
    if (visible) reset({ reason: defaultReason, description: "" });
  }, [defaultReason, reset, visible]);

  const submitReport = handleSubmit(async (values) => {
    const wasAccepted = await onSubmit({
      reason: values.reason as Reason,
      description: values.description,
    });
    if (wasAccepted) onClose();
  });

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={title}
      clickOutsideToClose={!isSubmitting}
    >
      <form className="content-report-modal__form" onSubmit={submitReport}>
        <Controller
          control={control}
          name="reason"
          render={({ field }) => (
            <SelectField
              label={reasonLabel}
              value={field.value}
              disabled={isSubmitting}
              onChange={field.onChange}
              options={reasons.map((reason) => ({
                key: reason.value,
                value: reason.value,
                label: reason.label,
              }))}
            />
          )}
        />

        <TextField
          {...register("description")}
          label={t("report_description_optional")}
          placeholder={t("report_description_placeholder")}
          maxLength={maxDescriptionLength}
          disabled={isSubmitting}
          error={errors.description?.message}
        />

        <Button
          type="submit"
          className="content-report-modal__submit"
          disabled={isSubmitting}
        >
          {t("report")}
        </Button>
      </form>
    </Modal>
  );
}
