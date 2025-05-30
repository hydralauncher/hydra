import { useCallback, useContext, useEffect } from "react";
import { Button, Modal, ModalProps, TextField } from "@renderer/components";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { GameArtifact } from "@types";
import { cloudSyncContext } from "@renderer/context";
import { logger } from "@renderer/logger";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { InferType } from "yup";
import { useToast } from "@renderer/hooks";

import "./cloud-sync-rename-artifact-modal.scss";

export interface CloudSyncRenameArtifactModalProps
  extends Omit<ModalProps, "children" | "title"> {
  artifact: GameArtifact | null;
}

export function CloudSyncRenameArtifactModal({
  visible,
  onClose,
  artifact,
}: Readonly<CloudSyncRenameArtifactModalProps>) {
  const { t } = useTranslation("game_details");

  const validationSchema = yup.object({
    label: yup
      .string()
      .required(t("required_field"))
      .max(255, t("max_length_field", { lenght: 255 })),
  });

  const { getGameArtifacts } = useContext(cloudSyncContext);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      label: artifact?.label ?? "",
    },
    resolver: yupResolver(validationSchema),
  });

  const { showSuccessToast } = useToast();

  useEffect(() => {
    if (artifact) {
      setValue("label", artifact.label ?? "");
    }
  }, [artifact, setValue]);

  const onSubmit = useCallback(
    async (data: InferType<typeof validationSchema>) => {
      try {
        if (!artifact) return;

        await window.electron.renameGameArtifact(artifact.id, data.label);
        await getGameArtifacts();

        showSuccessToast(t("artifact_renamed"));

        onClose();
      } catch (err) {
        logger.error("Failed to rename artifact", err);
      }
    },
    [artifact, getGameArtifacts, onClose, showSuccessToast, t]
  );

  return (
    <Modal
      visible={visible}
      title={t("rename_artifact")}
      description={t("rename_artifact_description")}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)}>
        <TextField
          label={t("artifact_name_label")}
          placeholder={t("artifact_name_placeholder")}
          {...register("label")}
          error={errors.label?.message}
        />

        <div className="cloud-sync-rename-artifact-modal__form-actions">
          <Button theme="outline" onClick={onClose}>
            {t("cancel")}
          </Button>

          <Button type="submit" disabled={isSubmitting}>
            {t("save_changes")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
