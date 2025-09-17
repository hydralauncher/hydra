import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import type { Game } from "@types";
import { useState, useEffect } from "react";
import { AlertIcon } from "@primer/octicons-react";
import "./change-game-playtime-modal.scss";

export interface ChangeGamePlaytimeModalProps {
  visible: boolean;
  game: Game;
  onClose: () => void;
  changePlaytime: (playTimeInSeconds: number) => Promise<void>;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

export function ChangeGamePlaytimeModal({
  onClose,
  game,
  visible,
  changePlaytime,
  onSuccess,
  onError,
}: Readonly<ChangeGamePlaytimeModalProps>) {
  const { t } = useTranslation("game_details");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible && game.playTimeInMilliseconds) {
      const totalMinutes = Math.floor(
        game.playTimeInMilliseconds / (1000 * 60)
      );
      const currentHours = Math.floor(totalMinutes / 60);
      const currentMinutes = totalMinutes % 60;

      setHours(currentHours.toString());
      setMinutes(currentMinutes.toString());
    } else if (visible) {
      setHours("");
      setMinutes("");
    }
  }, [visible, game.playTimeInMilliseconds]);

  const MAX_TOTAL_HOURS = 10000;

  const currentHours = parseInt(hours) || 0;
  const currentMinutes = parseInt(minutes) || 0;

  const maxAllowedHours = Math.min(
    MAX_TOTAL_HOURS,
    Math.floor(MAX_TOTAL_HOURS - currentMinutes / 60)
  );
  const maxAllowedMinutes =
    currentHours >= MAX_TOTAL_HOURS
      ? 0
      : Math.min(59, Math.floor((MAX_TOTAL_HOURS - currentHours) * 60));

  const handleChangePlaytime = async () => {
    const hoursNum = parseInt(hours) || 0;
    const minutesNum = parseInt(minutes) || 0;
    const totalSeconds = hoursNum * 3600 + minutesNum * 60;

    if (totalSeconds < 0) return;

    if (hoursNum + minutesNum / 60 > MAX_TOTAL_HOURS) return;

    setIsSubmitting(true);
    try {
      await changePlaytime(totalSeconds);
      onSuccess?.(t("change_playtime_success"));
      onClose();
    } catch (error) {
      onError?.(t("change_playtime_error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;

    if (value.length > 1 && value.startsWith("0")) {
      value = value.replace(/^0+/, "") || "0";
    }

    const numValue = parseInt(value) || 0;

    if (numValue <= maxAllowedHours) {
      setHours(value);
    }
  };

  const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;

    if (value.length > 1 && value.startsWith("0")) {
      value = value.replace(/^0+/, "") || "0";
    }

    const numValue = parseInt(value) || 0;

    if (numValue <= maxAllowedMinutes) {
      setMinutes(value);
    }
  };

  const isValid = hours !== "" || minutes !== "";

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={t("change_playtime_title")}
      description={t("change_playtime_description", {
        game: game.title,
      })}
    >
      <div className="change-game-playtime-modal__content">
        {!game.hasManuallyUpdatedPlaytime && (
          <div className="change-game-playtime-modal__warning">
            <AlertIcon size={16} />
            <span>{t("manual_playtime_warning")}</span>
          </div>
        )}

        <div className="change-game-playtime-modal__inputs">
          <TextField
            label={t("hours")}
            type="number"
            min="0"
            max={maxAllowedHours.toString()}
            value={hours}
            onChange={handleHoursChange}
            placeholder="0"
            theme="dark"
          />
          <TextField
            label={t("minutes")}
            type="number"
            min="0"
            max={maxAllowedMinutes.toString()}
            value={minutes}
            onChange={handleMinutesChange}
            placeholder="0"
            theme="dark"
          />
        </div>

        <div className="change-game-playtime-modal__actions">
          <Button
            onClick={handleChangePlaytime}
            theme="outline"
            disabled={!isValid || isSubmitting}
          >
            {t("change_playtime")}
          </Button>

          <Button onClick={onClose} theme="primary">
            {t("cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
