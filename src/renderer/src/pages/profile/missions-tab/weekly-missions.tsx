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
import {
  MISSIONS_TAB_PENDING_TOOLTIP_ID,
  PendingModerationBadge,
} from "./pending-moderation-badge";
import { MissionSwapButton } from "./mission-swap-button";
import { useMissionActions } from "./use-mission-actions";
import { useMissionFormat } from "./use-mission-format";

function WeeklyMissionRow({ mission }: Readonly<{ mission: Mission }>) {
  const { t } = useTranslation("user_profile");
  const { formatProgress } = useMissionFormat();
  const { claim, pendingAction } = useMissionActions();
  const isReady = mission.isComplete && !mission.isClaimed;

  const renderRight = () => {
    const reward = <RewardChips xp={mission.xp} coins={mission.coins} />;

    if (mission.isClaimed) {
      return (
        <>
          <span className="weekly-mission__meta">
            <DoneIcon isDim />
            {t("mission_claimed")}
          </span>
          {reward}
        </>
      );
    }

    if (isReady) {
      return (
        <>
          {reward}
          <button
            type="button"
            className="missions-tab__claim"
            disabled={pendingAction !== null}
            onClick={(event) => void claim(mission, event.currentTarget)}
          >
            {t("claim_reward")}
          </button>
        </>
      );
    }

    return (
      <>
        <span className="weekly-mission__meta">
          <ProgressIcon />
          {formatProgress(mission)}
          <PendingModerationBadge
            count={mission.pending}
            tooltipId={MISSIONS_TAB_PENDING_TOOLTIP_ID}
          />
        </span>
        {reward}
        <MissionSwapButton mission={mission} />
      </>
    );
  };

  return (
    <li
      className={cn("weekly-mission", {
        "weekly-mission--ready": isReady,
        "weekly-mission--claimed": mission.isClaimed,
      })}
    >
      <span className="weekly-mission__icon">
        <PixelIcon name={getMissionIcon(mission)} size={24} />
      </span>
      <div className="weekly-mission__text">
        <strong>{t(getMissionTitleKey(mission))}</strong>
        <small>{t(getMissionDescriptionKey(mission))}</small>
      </div>
      <div className="weekly-mission__right">{renderRight()}</div>
    </li>
  );
}

export function WeeklyMissions({
  period,
  resetLabel,
}: Readonly<{ period: MissionPeriod; resetLabel: string }>) {
  const { t } = useTranslation("user_profile");
  const done = period.missions.filter((mission) => mission.isComplete).length;

  return (
    <section className="missions-tab__section">
      <header className="missions-tab__section-header">
        <h2>{t("weekly_missions")}</h2>
        <span className="missions-tab__chip">
          {done} / {period.missions.length}
        </span>
        <span className="missions-tab__section-hint">{resetLabel}</span>
      </header>

      <ul className="weekly-missions">
        {period.missions.map((mission) => (
          <WeeklyMissionRow key={mission.slot} mission={mission} />
        ))}
      </ul>
    </section>
  );
}
