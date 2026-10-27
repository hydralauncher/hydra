import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  DoneIcon,
  PixelIcon,
  ProgressIcon,
  RewardChips,
} from "@renderer/components/gamification";
import type { Mission, MissionPeriod } from "@types";
import {
  getMissionDescriptionKey,
  getMissionIcon,
  getMissionTitleKey,
} from "./mission-catalog";
import { PendingModerationBadge } from "./pending-moderation-badge";
import { MissionSwapButton } from "./mission-swap-button";
import { useMissionActions } from "./use-mission-actions";
import { useMissionFormat } from "./use-mission-format";

function DailyMissionCard({ mission }: Readonly<{ mission: Mission }>) {
  const { t } = useTranslation("user_profile");
  const { formatProgress } = useMissionFormat();
  const { claim, pendingAction } = useMissionActions();

  const renderFooter = () => {
    if (mission.isClaimed) {
      return (
        <>
          <DoneIcon isDim />
          {t("mission_claimed")}
        </>
      );
    }

    if (mission.isComplete) {
      return (
        <button
          type="button"
          className="missions-tab__claim"
          disabled={pendingAction !== null}
          onClick={(event) => void claim(mission, event.currentTarget)}
        >
          {t("claim_reward")}
        </button>
      );
    }

    return (
      <>
        <ProgressIcon />
        {formatProgress(mission)}
        <PendingModerationBadge count={mission.pending} />
        <MissionSwapButton mission={mission} />
      </>
    );
  };

  return (
    <article
      className={cn("daily-mission", {
        "daily-mission--claimed": mission.isClaimed,
        "daily-mission--ready": mission.isComplete && !mission.isClaimed,
      })}
    >
      <span className="daily-mission__icon">
        <PixelIcon name={getMissionIcon(mission)} size={36} />
      </span>
      <div className="daily-mission__text">
        <strong>{t(getMissionTitleKey(mission))}</strong>
        <small>{t(getMissionDescriptionKey(mission))}</small>
      </div>
      <RewardChips
        xp={mission.xp}
        coins={mission.coins}
        className="daily-mission__reward"
      />
      <div className="daily-mission__footer">{renderFooter()}</div>
    </article>
  );
}

export function DailyMissions({
  period,
  resetLabel,
}: Readonly<{ period: MissionPeriod; resetLabel: string }>) {
  const { t } = useTranslation("user_profile");
  const done = period.missions.filter((mission) => mission.isComplete).length;

  return (
    <section className="missions-tab__section">
      <header className="missions-tab__section-header">
        <h2>{t("daily_missions")}</h2>
        <span className="missions-tab__chip">
          {done} / {period.missions.length}
        </span>
        <span className="missions-tab__section-hint">{resetLabel}</span>
      </header>

      <div className="missions-tab__daily-grid">
        {period.missions.map((mission) => (
          <DailyMissionCard key={mission.slot} mission={mission} />
        ))}
      </div>
    </section>
  );
}
