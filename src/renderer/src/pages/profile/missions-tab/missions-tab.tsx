import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CLOUD_BOOST_TOOLTIP_ID } from "@renderer/components/gamification";
import {
  useGamificationMissions,
  useGamificationProgress,
} from "@renderer/hooks";
import type { GamificationProgress } from "@types";
import { ProfileSection } from "../profile-section/profile-section";
import { LevelBox } from "../profile-content/level-box";
import { Tooltip } from "react-tooltip";
import { DailyMissions } from "./daily-missions";
import { MISSIONS_TAB_PENDING_TOOLTIP_ID } from "./pending-moderation-badge";
import { PassivesBox } from "./passives-box";
import { StreakBox } from "./streak-box";
import { TrailsBoard } from "./trails-board";
import { useMissionFormat, useNow } from "./use-mission-format";
import { WeeklyMissions } from "./weekly-missions";
import "./missions-tab.scss";

const PROGRESS_CHANGE_REFRESH_DELAY_MS = 1000;
const FOCUS_REFRESH_MIN_INTERVAL_MS = 30 * 1000;

export function MissionsTab() {
  const { missions, trails, refreshMissions, refreshTrails } =
    useGamificationMissions();
  const { refreshProgress } = useGamificationProgress();
  const { formatResetLabel } = useMissionFormat();
  const now = useNow();
  const lastRolloverRef = useRef<string | null>(null);

  useEffect(() => {
    void refreshMissions();
    void refreshTrails();
  }, [refreshMissions, refreshTrails]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let includeProgress = false;
    const scheduleRefresh = (withProgress: boolean) => {
      clearTimeout(timeout);
      includeProgress ||= withProgress;
      timeout = setTimeout(() => {
        void refreshMissions();
        void refreshTrails();
        if (includeProgress) void refreshProgress();
        includeProgress = false;
      }, PROGRESS_CHANGE_REFRESH_DELAY_MS);
    };
    let lastFocusRefreshAt = Date.now();
    const onFocus = () => {
      if (Date.now() - lastFocusRefreshAt < FOCUS_REFRESH_MIN_INTERVAL_MS) {
        return;
      }
      lastFocusRefreshAt = Date.now();
      scheduleRefresh(true);
    };
    const onSync = () => scheduleRefresh(false);

    globalThis.window.addEventListener("focus", onFocus);
    const unsubscribeSession =
      globalThis.window.electron.onGameSessionSynced(onSync);
    const unsubscribePlaytime =
      globalThis.window.electron.onGamePlaytimeSynced(onSync);

    return () => {
      clearTimeout(timeout);
      globalThis.window.removeEventListener("focus", onFocus);
      unsubscribeSession();
      unsubscribePlaytime();
    };
  }, [refreshMissions, refreshTrails, refreshProgress]);

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
      <Tooltip id={MISSIONS_TAB_PENDING_TOOLTIP_ID} />
      <Tooltip id={CLOUD_BOOST_TOOLTIP_ID} />
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
