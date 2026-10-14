import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import { Button, Modal } from "@renderer/components";
import type { Game } from "@types";
import { PlaytimeBreakdownTable } from "./playtime-breakdown-table";
import "./reset-achievements-modal.scss";

type ResetPlaytimeModalProps = Readonly<{
  visible: boolean;
  game: Game;
  playtimePreview?: Game | null;
  onClose: () => void;
  resetPlaytime: () => Promise<void>;
}>;

export function ResetPlaytimeModal({
  onClose,
  game,
  playtimePreview,
  visible,
  resetPlaytime,
}: ResetPlaytimeModalProps) {
  const { t } = useTranslation("game_details");
  const preview = playtimePreview ?? game;
  const steamPlayTimeInMilliseconds = preview.steamPlayTimeInMilliseconds ?? 0;
  const remainingHydraPlayTimeInMilliseconds = Math.max(
    0,
    preview.playTimeInMilliseconds - game.playTimeInMilliseconds
  );
  const tooltipId = useId();
  const hasNoPlaytime =
    (game.playTimeInMilliseconds ?? 0) <= 0 && !game.hasManuallyUpdatedPlaytime;

  const handleResetPlaytime = async () => {
    try {
      await resetPlaytime();
    } finally {
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={t("reset_playtime_title")}
      description={t("reset_playtime_description", {
        game: preview.title,
      })}
    >
      {steamPlayTimeInMilliseconds > 0 ||
      (preview.epicPlayTimeInMilliseconds ?? 0) > 0 ||
      remainingHydraPlayTimeInMilliseconds > 0 ? (
        <div className="reset-achievements-modal__playtime-breakdown">
          <PlaytimeBreakdownTable
            hydraPlayTimeInMilliseconds={preview.playTimeInMilliseconds ?? 0}
            nextHydraPlayTimeInMilliseconds={
              remainingHydraPlayTimeInMilliseconds
            }
            steamPlayTimeInMilliseconds={steamPlayTimeInMilliseconds}
            epicPlayTimeInMilliseconds={preview.epicPlayTimeInMilliseconds ?? 0}
          />
        </div>
      ) : null}
      <div className="reset-achievements-modal__actions">
        <Button onClick={onClose} theme="outline">
          {t("cancel")}
        </Button>

        <span
          className="reset-achievements-modal__action-tooltip"
          data-tooltip-id={hasNoPlaytime ? tooltipId : undefined}
          data-tooltip-content={
            hasNoPlaytime ? t("reset_playtime_disabled_tooltip") : undefined
          }
        >
          <Button
            onClick={handleResetPlaytime}
            theme="danger"
            disabled={hasNoPlaytime}
          >
            {t("reset_playtime")}
          </Button>
        </span>
        {hasNoPlaytime && <Tooltip id={tooltipId} />}
      </div>
    </Modal>
  );
}
