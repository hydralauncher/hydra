import { useRef, useState } from "react";
import { ReportIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { ConfirmationModal, TextField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import type { LeaderboardEntry } from "../game-details/leaderboard/game-leaderboard";
import type {
  GlobalLeaderboardPeriod,
  GlobalLeaderboardScope,
} from "./global-leaderboard";

// Same limit as the API (`reportUserValidationSchema`).
const REPORT_DESCRIPTION_MAX_LENGTH = 255;
const RATE_LIMITED_ERROR = "user/report-rate-limited";

// The board a report comes from; rank and value are added per entry.
export interface ReportBoardContext {
  metric: string;
  window: GlobalLeaderboardPeriod;
  scope: GlobalLeaderboardScope;
  game?: { shop: string; objectId: string } | null;
}

export function ReportCheaterButton({
  entry,
  onReport,
}: Readonly<{
  entry: LeaderboardEntry;
  onReport: (entry: LeaderboardEntry) => void;
}>) {
  const { t } = useTranslation("leaderboards");
  const label = t("report_cheater", { name: entry.user.displayName });

  return (
    <button
      type="button"
      className="leaderboards__report"
      onClick={() => onReport(entry)}
      aria-label={label}
      title={label}
    >
      <ReportIcon size={12} />
    </button>
  );
}

export function ReportCheaterModal({
  entry,
  context,
  formatValue,
  onClose,
}: Readonly<{
  entry: LeaderboardEntry | null;
  context: ReportBoardContext;
  formatValue: (value: number) => string;
  onClose: () => void;
}>) {
  const { t } = useTranslation("leaderboards");
  const { showSuccessToast, showErrorToast } = useToast();
  const [description, setDescription] = useState("");
  const [isSending, setIsSending] = useState(false);
  // Bumped whenever the modal closes, so a request that finishes after its
  // report was closed (and maybe another one opened) leaves the modal alone.
  const requestRef = useRef(0);

  const close = () => {
    requestRef.current += 1;
    setDescription("");
    setIsSending(false);
    onClose();
  };

  const send = async () => {
    if (!entry) return;
    const request = requestRef.current;
    const isCurrent = () => requestRef.current === request;
    setIsSending(true);

    try {
      await globalThis.window.electron.hydraApi.post(
        `/users/${entry.user.id}/report`,
        {
          data: {
            reason: "cheating",
            description: description.trim() || undefined,
            context: {
              source: "leaderboard",
              metric: context.metric,
              window: context.window,
              scope: context.scope,
              ...(context.game
                ? { shop: context.game.shop, objectId: context.game.objectId }
                : {}),
              rank: entry.rank,
              value: entry.value,
            },
          },
        }
      );
      showSuccessToast(t("report_cheater_sent"));
      if (isCurrent()) close();
    } catch (error) {
      logger.error("Failed to report leaderboard user", error);
      showErrorToast(
        t(
          error instanceof Error && error.message.includes(RATE_LIMITED_ERROR)
            ? "report_cheater_rate_limited"
            : "report_cheater_failed"
        )
      );
    } finally {
      if (isCurrent()) setIsSending(false);
    }
  };

  return (
    <ConfirmationModal
      visible={entry !== null}
      title={t("report_cheater_title")}
      descriptionText={
        entry
          ? t("report_cheater_description", {
              name: entry.user.displayName,
              rank: entry.rank,
              value: formatValue(entry.value),
            })
          : ""
      }
      confirmButtonLabel={t("report_cheater_confirm")}
      cancelButtonLabel={t("report_cheater_cancel")}
      confirmButtonIcon={<ReportIcon size={14} />}
      buttonsIsDisabled={isSending}
      onConfirm={send}
      onClose={close}
      clickOutsideToClose={!isSending}
    >
      <TextField
        label={t("report_cheater_details")}
        placeholder={t("report_cheater_details_placeholder")}
        value={description}
        maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
        onChange={(event) => setDescription(event.target.value)}
      />
    </ConfirmationModal>
  );
}
