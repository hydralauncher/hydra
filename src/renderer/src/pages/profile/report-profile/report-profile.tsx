import { ReportIcon } from "@primer/octicons-react";

import { Button, Modal, SelectField, TextField } from "@renderer/components";
import { useCallback, useContext, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as yup from "yup";
import { userProfileContext } from "@renderer/context";
import { yupResolver } from "@hookform/resolvers/yup";
import { useToast } from "@renderer/hooks";
import "./report-profile.scss";

const reportReasons = ["hate", "sexual_content", "violence", "spam", "other"];

interface FormValues {
  reason: string;
  description: string;
}

export function ReportProfile() {
  const [showReportProfileModal, setShowReportProfileModal] = useState(false);

  const { userProfile, isMe } = useContext(userProfileContext);

  const { t } = useTranslation("user_profile");

  const schema = yup.object().shape({
    reason: yup.string().required(t("required_field")),
    description: yup.string().required(t("required_field")),
  });

  const {
    register,
    control,
    formState: { isSubmitting, errors },
    reset,
    handleSubmit,
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: {
      reason: "hate",
      description: "",
    },
  });

  const { showSuccessToast } = useToast();

  useEffect(() => {
    reset({
      reason: "hate",
      description: "",
    });
  }, [userProfile, reset]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      return window.electron.hydraApi
        .post(`/users/${userProfile!.id}/report`, {
          data: {
            reason: values.reason,
            description: values.description,
          },
        })
        .then(() => {
          showSuccessToast(t("profile_reported"));
          setShowReportProfileModal(false);
        });
    },
    [userProfile, showSuccessToast, t]
  );

  if (isMe) return null;

  return (
    <>
      <Modal
        visible={showReportProfileModal}
        onClose={() => setShowReportProfileModal(false)}
        title={t("report_profile")}
        clickOutsideToClose={false}
      >
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="report-profile__form"
        >
          <Controller
            control={control}
            name="reason"
            render={({ field }) => {
              return (
                <SelectField
                  label={t("report_reason")}
                  value={field.value}
                  onChange={field.onChange}
                  options={reportReasons.map((reason) => ({
                    key: reason,
                    value: reason,
                    label: t(`report_reason_${reason}`),
                  }))}
                />
              );
            }}
          />

          <TextField
            {...register("description")}
            label={t("report_description")}
            placeholder={t("report_description_placeholder")}
            error={errors.description?.message}
          />

          <Button className="report-profile__submit">{t("report")}</Button>
        </form>
      </Modal>

      <button
        type="button"
        className="report-profile__button"
        onClick={() => setShowReportProfileModal(true)}
        disabled={isSubmitting}
      >
        <ReportIcon size={13} />
        {t("report_profile")}
      </button>
    </>
  );
}
