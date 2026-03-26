import { useCallback, useContext, useEffect } from "react";
import { Button, Modal, ModalProps, TextField } from "@renderer/components";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { GameArtifact, WebDavBackupEntry } from "@types";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";
import { logger } from "@renderer/logger";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { InferType } from "yup";
import { useToast } from "@renderer/hooks";

import "./cloud-sync-rename-artifact-modal.scss";

export interface CloudSyncRenameArtifactModalProps
  extends Omit<ModalProps, "children" | "title"> {
  artifact: GameArtifact | null;
  webDavBackup?: WebDavBackupEntry | null;
  onWebDavBackupRenamed?: () => void;
}

export function CloudSyncRenameArtifactModal({
  visible,
  onClose,
  artifact,
  webDavBackup,
  onWebDavBackupRenamed,
}: Readonly<CloudSyncRenameArtifactModalProps>) {
  const { t } = useTranslation("game_details");
  const { objectId, shop } = useContext(gameDetailsContext);

  const validationSchema = yup.object({
    label: yup
      .string()
      .required(t("required_field"))
      .max(255, t("max_length_field", { length: 255 })),
  });

  const { getGameArtifacts } = useContext(cloudSyncContext);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      label:
        artifact?.label ?? webDavBackup?.filename?.replace(/\.tar$/i, "") ?? "",
    },
    resolver: yupResolver(validationSchema),
  });

  const { showSuccessToast, showErrorToast } = useToast();

  useEffect(() => {
    if (artifact) {
      setValue("label", artifact.label ?? "");
    } else if (webDavBackup) {
      setValue("label", webDavBackup.filename?.replace(/\.tar$/i, "") ?? "");
    }
  }, [artifact, webDavBackup, setValue]);

  const onSubmit = useCallback(
    async (data: InferType<typeof validationSchema>) => {
      try {
        if (artifact) {
          await window.electron.hydraApi.put(
            `/profile/games/artifacts/${artifact.id}`,
            {
              data: {
                label: data.label,
              },
            }
          );
          await getGameArtifacts();
        } else if (webDavBackup && objectId) {
          await window.electron.renameWebDavBackup(
            objectId,
            shop,
            webDavBackup.href,
            data.label
          );
          if (onWebDavBackupRenamed) {
            onWebDavBackupRenamed();
          }
        } else {
          return;
        }

        showSuccessToast(t("artifact_renamed"));
        onClose();
      } catch (err) {
        logger.error("Failed to rename backup", err);
        showErrorToast("Failed to rename backup");
      }
    },
    [
      artifact,
      webDavBackup,
      objectId,
      shop,
      getGameArtifacts,
      onClose,
      showSuccessToast,
      showErrorToast,
      t,
      onWebDavBackupRenamed,
    ]
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
