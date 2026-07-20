import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal } from "@renderer/components";
import type { GameShop } from "@types";
import { useForm } from "react-hook-form";
import { useAppSelector } from "@renderer/hooks";
import { logger } from "@renderer/logger";

import "./manage-trackers-modal.scss";

interface ManageTrackersModalProps {
  visible: boolean;
  onClose: () => void;
  shop?: GameShop;
  objectId?: string;
  initialTrackers: string[];
  onTrackersSaved?: () => void;
  onSave?: (trackers: string[]) => void;
}

interface FormValues {
  trackers: string;
}

export function ManageTrackersModal({
  visible,
  onClose,
  shop,
  objectId,
  initialTrackers,
  onTrackersSaved,
  onSave,
}: ManageTrackersModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const { t } = useTranslation("downloads");

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const globalTrackers = useMemo(() => {
    return [
      ...(userPreferences?.appendGlobalTrackers
        ? (userPreferences?.globalTrackers ?? [])
        : []),
      ...(userPreferences?.appendGlobalTrackersUrl
        ? (userPreferences?.globalTrackersUrlCache ?? [])
        : []),
    ];
  }, [userPreferences]);

  const allTier0Trackers = useMemo(() => {
    return [...new Set([...globalTrackers, ...(initialTrackers ?? [])])];
  }, [globalTrackers, initialTrackers]);

  const { register, handleSubmit, setValue } = useForm<FormValues>();

  const onSubmit = async (values: FormValues) => {
    setIsLoading(true);

    try {
      const trackers = values.trackers
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (onSave) {
        onSave(trackers);
      } else {
        await window.electron.setDownloadTrackers(shop!, objectId!, trackers);
        onTrackersSaved?.();
      }

      onClose();
    } catch (error) {
      logger.error("Failed to save trackers:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setValue("trackers", allTier0Trackers.join("\n"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleClose = () => {
    if (isLoading) return;
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title="Manage Trackers"
      onClose={handleClose}
      clickOutsideToClose={!isLoading}
      large
      noContentPadding
    >
      <div className="manage-trackers-modal__container">
        <form
          className="manage-trackers-modal__form"
          onSubmit={handleSubmit(onSubmit)}
        >
          <textarea
            {...register("trackers")}
            className="manage-trackers-modal__textarea"
            placeholder="udp://tracker.example.com:1337/announce"
          />

          <div className="manage-trackers-modal__actions">
            <Button
              type="button"
              theme="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              {t("cancel")}
            </Button>

            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : "Save Trackers"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
