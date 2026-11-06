import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GlobeIcon,
  GraphIcon,
  PeopleIcon,
  TrophyIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";
import { AuthPage, formatOverlayHotkey, normalizeOverlayHotkey } from "@shared";

import { Avatar, Button } from "@renderer/components";
import { setUserPreferences } from "@renderer/features";
import {
  useAppDispatch,
  useAppSelector,
  useUserDetails,
} from "@renderer/hooks";
import { useActiveTheme } from "@renderer/hooks/use-active-theme";
import type { OverlayGameInfo, OverlayPanelStatus } from "@types";

import { OverlayAchievements } from "./overlay-achievements";
import { OverlayChat } from "./overlay-chat";
import { useOverlayAchievements } from "./use-overlay-achievements";
import { LeaderboardSection } from "../game-details/leaderboard/leaderboard-section";
import { isLeaderboardShop } from "../game-details/leaderboard/game-leaderboard";

const electron = globalThis.electron as Electron;

type OverlayTab = "friends" | "achievements" | "leaderboard" | "browser";

interface OverlayBigPictureProps {
  game: OverlayGameInfo;
  panels: OverlayPanelStatus[];
}

/**
 * Big Picture keeps the original full-window tabbed overlay. The default
 * desktop overlay uses the Steam-style dock and separate panel windows.
 */
export function OverlayBigPicture({
  game,
  panels,
}: Readonly<OverlayBigPictureProps>) {
  const { t } = useTranslation("overlay");
  const dispatch = useAppDispatch();
  const preferences = useAppSelector((state) => state.userPreferences.value);
  const { userDetails, fetchUserDetails, updateUserDetails } = useUserDetails();

  const [activeTab, setActiveTab] = useState<OverlayTab>("friends");
  const [hasResolvedUser, setHasResolvedUser] = useState(() =>
    Boolean(userDetails)
  );

  useActiveTheme();
  const { achievements } = useOverlayAchievements(
    game,
    preferences?.retroAchievementsWebApiKey
  );

  useEffect(() => {
    if (preferences) return;

    let cancelled = false;

    void electron
      .getUserPreferences()
      .then((value) => {
        if (!cancelled) dispatch(setUserPreferences(value));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [dispatch, preferences]);

  useEffect(() => {
    if (userDetails) {
      setHasResolvedUser(true);
      return;
    }

    let cancelled = false;

    void fetchUserDetails()
      .then((details) => {
        if (!details) return;
        void updateUserDetails(details).catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHasResolvedUser(true);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchUserDetails, updateUserDetails, userDetails]);

  useEffect(() => {
    if (activeTab === "achievements" && achievements.length === 0) {
      setActiveTab("friends");
    }
  }, [activeTab, achievements.length]);

  const overlayHotkey = normalizeOverlayHotkey(preferences?.overlayHotkey);
  const hasAchievements = achievements.length > 0;
  const hasLeaderboard = isLeaderboardShop(game.shop);
  const browserEnabled = preferences?.overlayBrowserEnabled ?? true;
  const isBrowserOpen = Boolean(
    panels.find((panel) => panel.panel === "browser")?.isOpen
  );

  return (
    <div className="overlay">
      <div className="overlay__panel">
        <aside className="overlay__nav">
          <div className="overlay__game">
            <Avatar
              size={40}
              src={game.iconUrl}
              alt=""
              className="overlay__game-icon"
            />
            <div className="overlay__game-details">
              <span className="overlay__game-title" title={game.title}>
                {game.title}
              </span>
              <span className="overlay__hint">
                {t("hotkey_hint", { key: formatOverlayHotkey(overlayHotkey) })}
              </span>
            </div>
          </div>

          <nav className="overlay__tabs" aria-label={t("title")}>
            <button
              type="button"
              className={cn("overlay__tab", {
                "overlay__tab--active": activeTab === "friends",
              })}
              onClick={() => setActiveTab("friends")}
              aria-pressed={activeTab === "friends"}
            >
              <PeopleIcon size={16} />
              <span>{t("friends")}</span>
            </button>

            {hasAchievements && (
              <button
                type="button"
                className={cn("overlay__tab", {
                  "overlay__tab--active": activeTab === "achievements",
                })}
                onClick={() => setActiveTab("achievements")}
                aria-pressed={activeTab === "achievements"}
              >
                <TrophyIcon size={16} />
                <span>{t("achievements")}</span>
              </button>
            )}

            {hasLeaderboard && (
              <button
                type="button"
                className={cn("overlay__tab", {
                  "overlay__tab--active": activeTab === "leaderboard",
                })}
                onClick={() => setActiveTab("leaderboard")}
                aria-pressed={activeTab === "leaderboard"}
              >
                <GraphIcon size={16} />
                <span>{t("leaderboard")}</span>
              </button>
            )}

            {browserEnabled && (
              <button
                type="button"
                className={cn("overlay__tab", {
                  "overlay__tab--active": activeTab === "browser",
                })}
                onClick={() => setActiveTab("browser")}
                aria-pressed={activeTab === "browser"}
              >
                <GlobeIcon size={16} />
                <span>{t("browser")}</span>
              </button>
            )}
          </nav>

          <div className="overlay__nav-footer">
            <Button
              theme="dark"
              size="small"
              className="overlay__close"
              onClick={() => void electron.closeOverlay()}
            >
              <XIcon size={14} />
              {t("close")}
            </Button>
          </div>
        </aside>

        <div className="overlay__content">
          <div
            className={cn("overlay__pane", {
              "overlay__pane--hidden": activeTab !== "friends",
            })}
          >
            {!hasResolvedUser ? (
              <div className="overlay__empty">
                <p>{t("loading")}</p>
              </div>
            ) : userDetails ? (
              <OverlayChat
                onClose={() => void electron.closeOverlay()}
                syncOverlayWindowState={
                  activeTab === "friends" ? "bigPicture" : undefined
                }
              />
            ) : (
              <div className="overlay__empty">
                <p>{t("sign_in_required")}</p>
                <Button
                  onClick={() => void electron.openAuthWindow(AuthPage.SignIn)}
                >
                  {t("sign_in")}
                </Button>
              </div>
            )}
          </div>

          {activeTab === "achievements" && (
            <OverlayAchievements game={game} achievements={achievements} />
          )}

          {activeTab === "leaderboard" && hasLeaderboard && (
            <div className="overlay-leaderboard">
              <LeaderboardSection
                shop={game.shop}
                objectId={game.objectId}
                framed={false}
                showFullRankingLink={false}
                onUserSelect={(userId) => {
                  void electron.openFriendProfileInMainWindow(userId);
                }}
              />
            </div>
          )}

          {activeTab === "browser" && browserEnabled && (
            <div className="overlay__empty">
              <p>{t("browser_fullscreen_hint")}</p>
              <Button
                theme="outline"
                size="small"
                onClick={() => {
                  if (isBrowserOpen) {
                    void electron.closeOverlayPanel("browser");
                  } else {
                    void electron.openOverlayPanel("browser");
                  }
                }}
              >
                {isBrowserOpen ? t("close_browser") : t("open_browser")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
