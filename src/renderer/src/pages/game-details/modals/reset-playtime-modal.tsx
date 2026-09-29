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
  onClose: () => void;
  resetPlaytime: () => Promise<void>;
}>;

export function ResetPlaytimeModal({
  onClose,
  game,
  visible,
  resetPlaytime,
}: ResetPlaytimeModalProps) {
  const { t } = useTranslation("game_details");
  const steamPlayTimeInMilliseconds = game.steamPlayTimeInMilliseconds ?? 0;
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
        game: game.title,
      })}
    >
      {steamPlayTimeInMilliseconds > 0 ? (
        <div className="reset-achievements-modal__playtime-breakdown">
          <PlaytimeBreakdownTable
            hydraPlayTimeInMilliseconds={game.playTimeInMilliseconds ?? 0}
            nextHydraPlayTimeInMilliseconds={0}
            steamPlayTimeInMilliseconds={steamPlayTimeInMilliseconds}
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
