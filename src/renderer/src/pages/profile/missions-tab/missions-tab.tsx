import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useGamificationMissions } from "@renderer/hooks";
import type { GamificationProgress } from "@types";
import { ProfileSection } from "../profile-section/profile-section";
import { LevelBox } from "../profile-content/level-box";
import { DailyMissions } from "./daily-missions";
import { PassivesBox } from "./passives-box";
import { StreakBox } from "./streak-box";
import { TrailsBoard } from "./trails-board";
import { useMissionFormat, useNow } from "./use-mission-format";
import { WeeklyMissions } from "./weekly-missions";
import "./missions-tab.scss";

export function MissionsTab() {
  const { missions, trails, refreshMissions, refreshTrails } =
    useGamificationMissions();
  const { formatResetLabel } = useMissionFormat();
  const now = useNow();
  const lastRolloverRef = useRef<string | null>(null);

  useEffect(() => {
    void refreshMissions();
    void refreshTrails();
  }, [refreshMissions, refreshTrails]);

  // Fetch again once a period rolls over while the tab is open.
  useEffect(() => {
    if (!missions) return;
    const nextReset = Math.min(
      Date.parse(missions.daily.resetsAt),
      Date.parse(missions.weekly.resetsAt)
    );
    const rolloverKey = `${missions.daily.period}:${missions.weekly.period}`;
    if (now >= nextReset && lastRolloverRef.current !== rolloverKey) {
      lastRolloverRef.current = rolloverKey;
      void refreshMissions();
    }
  }, [now, missions, refreshMissions]);

  return (
    <div className="missions-tab">
      <div className="missions-tab__layout">
        {missions && (
          <div className="missions-tab__pair">
            <DailyMissions
              period={missions.daily}
              resetLabel={formatResetLabel(missions.daily.resetsAt, now, false)}
            />
            <WeeklyMissions
              period={missions.weekly}
              resetLabel={formatResetLabel(missions.weekly.resetsAt, now, true)}
            />
          </div>
        )}
        {trails && <TrailsBoard trails={trails} />}
      </div>
    </div>
  );
}

export function MissionsSidebar({
  progress,
}: Readonly<{ progress: GamificationProgress }>) {
  const { t } = useTranslation("user_profile");

  return (
    <>
      <ProfileSection title={t("level_title")} defaultOpen={true}>
        <LevelBox level={progress} />
      </ProfileSection>
      <ProfileSection title={t("streak_title")} defaultOpen={true}>
        <StreakBox streak={progress.loginStreak} />
      </ProfileSection>
      <ProfileSection title={t("how_to_earn_xp")} defaultOpen={true}>
        <PassivesBox passives={progress.passives} />
      </ProfileSection>
    </>
  );
}
