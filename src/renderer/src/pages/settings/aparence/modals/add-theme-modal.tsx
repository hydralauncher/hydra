import { Modal } from "@renderer/components/modal/modal";
import { TextField } from "@renderer/components/text-field/text-field";
import { Button } from "@renderer/components/button/button";
import { useTranslation } from "react-i18next";
import { useUserDetails } from "@renderer/hooks";
import { Theme } from "@types";
import { useForm } from "react-hook-form";

import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useCallback } from "react";

import "./modals.scss";

interface AddThemeModalProps {
  visible: boolean;
  onClose: () => void;
  onThemeAdded: () => void;
}

interface FormValues {
  name: string;
}

export function AddThemeModal({
  visible,
  onClose,
  onThemeAdded,
}: Readonly<AddThemeModalProps>) {
  const { t } = useTranslation("settings");
  const { userDetails } = useUserDetails();

  const schema = yup.object({
    name: yup
      .string()
      .required(t("required_field"))
      .min(3, t("name_min_length")),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
  });

  const onSubmit = useCallback(
    async (values: FormValues) => {
      const theme: Theme = {
        id: crypto.randomUUID(),
        name: values.name,
        isActive: false,
        author: userDetails?.id,
        authorName: userDetails?.username,
        code: "/* Your theme goes here */",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await window.electron.addCustomTheme(theme);
      onThemeAdded();
      onClose();
      reset();
    },
    [onClose, onThemeAdded, userDetails?.id, userDetails?.username, reset]
  );

  return (
    <Modal
      visible={visible}
      title={t("create_theme_modal_title")}
      description={t("create_theme_modal_description")}
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="add-theme-modal__container"
      >
        <TextField
          {...register("name")}
          label={t("theme_name")}
          placeholder={t("insert_theme_name")}
          hint={errors.name?.message}
          error={errors.name?.message}
        />

        <Button type="submit" theme="primary" disabled={isSubmitting}>
          {t("create_theme")}
        </Button>
      </form>
    </Modal>
  );
}
