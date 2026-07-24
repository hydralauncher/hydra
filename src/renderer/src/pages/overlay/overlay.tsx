import type {
  HydraOverlayContext,
  HydraOverlayGamepadAction,
  ProfileFriends,
  UserAchievement,
  UserFriend,
} from "@types";
import {
  Battery,
  Check,
  Clock3,
  LockKeyhole,
  NotebookPen,
  Power,
  Save,
  TimerReset,
  Trophy,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./overlay.scss";
import { OverlayPerformance } from "./overlay-performance";
import OverlayToast from "./overlay-toast";

interface BatteryManager extends EventTarget {
  charging: boolean;
  level: number;
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManager>;
};

type OverlayTab = "overview" | "friends" | "achievements" | "notes";
type Direction = "up" | "down" | "left" | "right";
type OverlayMode = "full" | "pinned" | "hidden" | "toast";
type BatteryStatus = { level: number; charging: boolean } | null;

const TABS: OverlayTab[] = ["overview", "friends", "achievements", "notes"];

const formatDuration = (milliseconds: number) => {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const getFocusableElements = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-overlay-focusable]:not(:disabled)"
    )
  ).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

const focusForController = (element: HTMLElement | null) => {
  document
    .querySelectorAll(".is-controller-focused")
    .forEach((candidate) =>
      candidate.classList.remove("is-controller-focused")
    );
  if (!element) return;
  element.classList.add("is-controller-focused");
  element.focus({ preventScroll: false });
};

const getPrimaryOffset = (
  direction: Direction,
  horizontal: number,
  vertical: number
) => {
  switch (direction) {
    case "left":
      return -horizontal;
    case "right":
      return horizontal;
    case "up":
      return -vertical;
    case "down":
      return vertical;
  }
};

const moveControllerFocus = (direction: Direction) => {
  const candidates = getFocusableElements();
  if (!candidates.length) return;
  const current =
    document.querySelector<HTMLElement>(".is-controller-focused") ??
    candidates[0];
  const currentRect = current.getBoundingClientRect();
  const currentX = currentRect.left + currentRect.width / 2;
  const currentY = currentRect.top + currentRect.height / 2;

  const scored = candidates
    .filter((candidate) => candidate !== current)
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const horizontal = x - currentX;
      const vertical = y - currentY;
      const primary = getPrimaryOffset(direction, horizontal, vertical);
      const secondary =
        direction === "left" || direction === "right"
          ? Math.abs(vertical)
          : Math.abs(horizontal);
      return { candidate, primary, score: primary * 3 + secondary };
    })
    .filter(({ primary }) => primary > 4)
    .sort((left, right) => left.score - right.score);

  focusForController(scored[0]?.candidate ?? current);
};

const getBatteryLabel = (battery: BatteryStatus) => {
  if (!battery) return "Desktop";
  return `${battery.level}%${battery.charging ? " ⚡" : ""}`;
};

const AchievementResult = ({
  achievement,
}: Readonly<{ achievement: UserAchievement }>) => {
  if (achievement.points) {
    return (
      <b>
        <Trophy size={13} /> {achievement.points}
      </b>
    );
  }
  return achievement.unlocked ? <Check size={17} /> : <LockKeyhole size={16} />;
};

type OverlayTabsProps = Readonly<{
  activeTab: OverlayTab;
  onlineFriends: number;
  achievementCount: string;
  onSelect: (tab: OverlayTab) => void;
}>;

const OverlayTabs = ({
  activeTab,
  onlineFriends,
  achievementCount,
  onSelect,
}: OverlayTabsProps) => (
  <nav className="overlay-tabs" aria-label="Overlay sections">
    <button
      type="button"
      data-overlay-focusable
      data-overlay-tab="overview"
      className={activeTab === "overview" ? "is-active" : ""}
      onClick={() => onSelect("overview")}
    >
      <UserRound size={18} /> <span>Overview</span>
    </button>
    <button
      type="button"
      data-overlay-focusable
      data-overlay-tab="friends"
      className={activeTab === "friends" ? "is-active" : ""}
      onClick={() => onSelect("friends")}
    >
      <UsersRound size={18} /> <span>Friends</span>
      {onlineFriends > 0 && <i>{onlineFriends}</i>}
    </button>
    <button
      type="button"
      data-overlay-focusable
      data-overlay-tab="achievements"
      className={activeTab === "achievements" ? "is-active" : ""}
      onClick={() => onSelect("achievements")}
    >
      <Trophy size={18} /> <span>Achievements</span>
      <i>{achievementCount}</i>
    </button>
    <button
      type="button"
      data-overlay-focusable
      data-overlay-tab="notes"
      className={activeTab === "notes" ? "is-active" : ""}
      onClick={() => onSelect("notes")}
    >
      <NotebookPen size={18} /> <span>Notes</span>
    </button>
  </nav>
);

const renderNonFullOverlay = (
  mode: OverlayMode,
  context: HydraOverlayContext
) => {
  switch (mode) {
    case "hidden":
      return null;
    case "toast":
      return (
        <main className="hydra-overlay hydra-overlay--injected-toast">
          <OverlayToast />
        </main>
      );
    case "pinned":
      return context.settings.performanceEnabled ? (
        <main className="hydra-overlay hydra-overlay--pinned-performance">
          <OverlayPerformance
            metrics={context.performance}
            rows={context.settings.performanceRows}
            compact
          />
        </main>
      ) : null;
    case "full":
      return undefined;
  }
};

export default function Overlay() {
  const [context, setContext] = useState<HydraOverlayContext | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [battery, setBattery] = useState<BatteryStatus>(null);
  const [activeTab, setActiveTab] = useState<OverlayTab>("overview");
  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [onlineFriends, setOnlineFriends] = useState(0);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(true);
  const [confirmExit, setConfirmExit] = useState(false);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("full");
  const noteLoaded = useRef(false);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const refresh = useCallback(() => {
    globalThis.electron.getOverlayContext().then(setContext);
  }, []);

  const selectTab = useCallback((tab: OverlayTab, controller = false) => {
    setActiveTab(tab);
    if (controller) {
      window.requestAnimationFrame(() =>
        focusForController(
          document.querySelector<HTMLElement>(`[data-overlay-tab="${tab}"]`)
        )
      );
    }
  }, []);

  const handleGamepadAction = useCallback(
    (action: HydraOverlayGamepadAction) => {
      if (action === "back") {
        void globalThis.electron.closeHydraOverlay();
        return;
      }
      if (action === "accept") {
        const focused = document.querySelector<HTMLElement>(
          ".is-controller-focused"
        );
        focused?.focus();
        if (!(focused instanceof HTMLTextAreaElement)) focused?.click();
        return;
      }
      if (action === "previous-tab" || action === "next-tab") {
        const offset = action === "previous-tab" ? -1 : 1;
        const index = TABS.indexOf(activeTabRef.current);
        selectTab(TABS[(index + offset + TABS.length) % TABS.length], true);
        return;
      }
      moveControllerFocus(action);
    },
    [selectTab]
  );

  useEffect(() => {
    refresh();
    globalThis.electron.getOverlayNote().then((savedNote) => {
      setNote(savedNote);
      noteLoaded.current = true;
    });
    (
      globalThis.electron.hydraApi.get("/profile/friends", {
        params: { take: 50, skip: 0 },
      }) as Promise<ProfileFriends>
    )
      .then((response) => {
        setFriends(response.friends);
        setOnlineFriends(response.onlineFriends);
      })
      .catch(() => undefined);

    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const unsubscribeShown = globalThis.electron.onOverlayShown(() => {
      refresh();
      window.requestAnimationFrame(() =>
        focusForController(
          document.querySelector<HTMLElement>(
            `[data-overlay-tab="${activeTabRef.current}"]`
          )
        )
      );
    });
    const unsubscribePerformance = globalThis.electron.onOverlayPerformance(
      (performance) =>
        setContext((current) =>
          current ? { ...current, performance } : current
        )
    );
    const unsubscribePerformancePin =
      globalThis.electron.onOverlayPerformancePin((performancePinned) =>
        setContext((current) =>
          current ? { ...current, performancePinned } : current
        )
      );
    const unsubscribeMode = globalThis.electron.onOverlayMode(setOverlayMode);
    const unsubscribeGamepad =
      globalThis.electron.onOverlayGamepadAction(handleGamepadAction);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab" && event.shiftKey) event.preventDefault();
      if (event.key === "Escape") void globalThis.electron.closeHydraOverlay();
      if (event.target instanceof HTMLTextAreaElement) return;
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        moveControllerFocus(
          event.key.replace("Arrow", "").toLowerCase() as Direction
        );
      }
      if (event.key === "Enter") {
        document.querySelector<HTMLElement>(".is-controller-focused")?.click();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      clearInterval(clock);
      unsubscribeShown();
      unsubscribePerformance();
      unsubscribePerformancePin();
      unsubscribeMode();
      unsubscribeGamepad();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleGamepadAction, refresh]);

  useEffect(() => {
    if (!noteLoaded.current) return;
    setNoteSaved(false);
    const timeout = window.setTimeout(() => {
      globalThis.electron.saveOverlayNote(note).then(() => setNoteSaved(true));
    }, 500);
    return () => clearTimeout(timeout);
  }, [note]);

  useEffect(() => {
    let manager: BatteryManager | null = null;
    const update = () => {
      if (manager) {
        setBattery({
          level: Math.round(manager.level * 100),
          charging: manager.charging,
        });
      }
    };
    (navigator as NavigatorWithBattery)
      .getBattery?.()
      .then((value) => {
        manager = value;
        update();
        manager.addEventListener("levelchange", update);
        manager.addEventListener("chargingchange", update);
      })
      .catch(() => undefined);
    return () => {
      manager?.removeEventListener("levelchange", update);
      manager?.removeEventListener("chargingchange", update);
    };
  }, []);

  const progress = useMemo(() => {
    const achievements = context?.achievements ?? [];
    const unlocked = achievements.filter((achievement) => achievement.unlocked);
    const earnedPoints = unlocked.reduce(
      (sum, achievement) => sum + (achievement.points ?? 0),
      0
    );
    const totalPoints = achievements.reduce(
      (sum, achievement) => sum + (achievement.points ?? 0),
      0
    );
    return {
      unlocked,
      locked: achievements.filter((achievement) => !achievement.unlocked),
      percentage: achievements.length
        ? Math.round((unlocked.length / achievements.length) * 100)
        : 0,
      earnedPoints,
      totalPoints,
    };
  }, [context]);

  if (!context) return <div className="hydra-overlay hydra-overlay--loading" />;
  const nonFullOverlay = renderNonFullOverlay(overlayMode, context);
  if (overlayMode !== "full") return nonFullOverlay ?? null;

  const { game, user } = context;
  const sessionDuration = now - game.sessionStartedAt;
  const endGame = async () => {
    await globalThis.electron.closeGame(game.shop, game.objectId);
    await globalThis.electron.closeHydraOverlay();
  };

  return (
    <main
      className="hydra-overlay hydra-overlay--vertical"
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.dataset.overlayFocusable !== undefined)
          focusForController(target);
      }}
      onPointerDownCapture={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-overlay-focusable]"
        );
        if (target) focusForController(target);
      }}
    >
      {game.heroImageUrl && (
        <img
          className="hydra-overlay__backdrop"
          src={game.heroImageUrl}
          alt=""
        />
      )}
      <div className="hydra-overlay__scrim" />

      {context.settings.performanceEnabled && (
        <div className="hydra-overlay__performance-widget">
          <OverlayPerformance
            metrics={context.performance}
            rows={context.settings.performanceRows}
            pinned={context.performancePinned}
            onPinnedChange={(performancePinned) => {
              setContext((current) =>
                current ? { ...current, performancePinned } : current
              );
              void globalThis.electron.setOverlayPerformancePinned(
                performancePinned
              );
            }}
          />
        </div>
      )}

      <div className="hydra-overlay__workspace">
        <section className="overlay-surface overlay-hub">
          <OverlayTabs
            activeTab={activeTab}
            onlineFriends={onlineFriends}
            achievementCount={`${progress.unlocked.length}/${context.achievements.length}`}
            onSelect={selectTab}
          />

          <div className="overlay-hub__content">
            {activeTab === "overview" && (
              <div className="overlay-overview-redesign">
                <section className="overlay-game-hero">
                  {game.heroImageUrl && <img src={game.heroImageUrl} alt="" />}
                  <div />
                  {game.logoImageUrl ? (
                    <img
                      className="overlay-game-hero__logo"
                      src={game.logoImageUrl}
                      alt={game.title}
                    />
                  ) : (
                    <strong>{game.title}</strong>
                  )}
                </section>
                <section className="overlay-playing-now">
                  <span>Playing now</span>
                  <strong>Playing for {formatDuration(sessionDuration)}</strong>
                  <div>
                    <span>
                      <TimerReset size={14} /> Current session
                    </span>
                    <span>
                      <Battery size={14} /> {getBatteryLabel(battery)}
                    </span>
                  </div>
                </section>
                <section className="overlay-overview-counters">
                  <div>
                    <Trophy size={23} />
                    <strong>{progress.unlocked.length}</strong>
                    <span>Achievements</span>
                  </div>
                  <div>
                    <Clock3 size={23} />
                    <strong>
                      {formatDuration(
                        game.playTimeInMilliseconds + sessionDuration
                      )}
                    </strong>
                    <span>Hours played</span>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "friends" && (
              <div className="overlay-list-view overlay-friends-view">
                <header>
                  <div>
                    <h2>Friends</h2>
                    <span>{onlineFriends} online now</span>
                  </div>
                </header>
                {!friends.length ? (
                  <div className="overlay-empty">
                    <UsersRound size={32} />
                    <strong>No friends to show</strong>
                    <span>Sign in or check your connection.</span>
                  </div>
                ) : (
                  <div className="overlay-friends-list">
                    {friends.map((friend) => (
                      <article key={friend.id}>
                        {friend.profileImageUrl ? (
                          <img src={friend.profileImageUrl} alt="" />
                        ) : (
                          <div>{friend.displayName.slice(0, 1)}</div>
                        )}
                        <span>
                          <strong>{friend.displayName}</strong>
                          <small>
                            {friend.currentGame?.title ??
                              (friend.isOnline ? "Online" : "Offline")}
                          </small>
                        </span>
                        <i className={friend.isOnline ? "is-online" : ""} />
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "achievements" && (
              <div className="overlay-achievements-redesign">
                <section className="overlay-achievements-hero">
                  {game.heroImageUrl && <img src={game.heroImageUrl} alt="" />}
                  <div className="overlay-achievements-hero__shade" />
                  {game.logoImageUrl && (
                    <img
                      className="overlay-achievements-hero__logo"
                      src={game.logoImageUrl}
                      alt={game.title}
                    />
                  )}
                  <div className="overlay-achievements-progress">
                    <span>
                      {progress.unlocked.length} / {context.achievements.length}
                    </span>
                    <strong>
                      <Trophy size={20} /> {progress.percentage}%
                    </strong>
                  </div>
                  <i>
                    <span style={{ width: `${progress.percentage}%` }} />
                  </i>
                </section>
                <div className="overlay-earned-points">
                  Earned points{" "}
                  <strong>
                    <Trophy size={14} /> {progress.earnedPoints} /{" "}
                    {progress.totalPoints}
                  </strong>
                </div>
                {!context.achievements.length ? (
                  <div className="overlay-empty">
                    <Trophy size={32} />
                    <strong>No tracked achievements yet</strong>
                    <span>Hydra will show them here when available.</span>
                  </div>
                ) : (
                  <div className="overlay-achievement-list">
                    {[...progress.unlocked, ...progress.locked].map(
                      (achievement) => (
                        <article
                          className={!achievement.unlocked ? "is-locked" : ""}
                          key={achievement.name}
                        >
                          <img
                            src={
                              achievement.unlocked
                                ? achievement.icon
                                : achievement.icongray || achievement.icon
                            }
                            alt=""
                          />
                          <span>
                            <strong>{achievement.displayName}</strong>
                            <small>
                              {achievement.description ?? "Hidden achievement"}
                            </small>
                          </span>
                          <AchievementResult achievement={achievement} />
                        </article>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === "notes" && (
              <div className="overlay-notes-tab">
                <header>
                  <div>
                    <NotebookPen size={20} />
                    <span>
                      <strong>Game notes</strong>
                      <small>Saved for {game.title}</small>
                    </span>
                  </div>
                  <span className={noteSaved ? "is-saved" : ""}>
                    <Save size={13} />
                    {noteSaved ? "Saved" : "Saving…"}
                  </span>
                </header>
                <textarea
                  data-overlay-focusable
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Build ideas, quest clues, controls, or anything you want to remember…"
                  spellCheck
                />
                <footer>{note.length.toLocaleString()} / 20,000</footer>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="hydra-overlay__footer">
        <section className="hydra-overlay__identity">
          {user?.profileImageUrl ? (
            <img src={user.profileImageUrl} alt="" />
          ) : (
            <div className="hydra-overlay__avatar-fallback">
              {(user?.displayName ?? "G").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <span>Hello,</span>
            <strong>{user?.displayName ?? "Guest"}</strong>
          </div>
          <div className="hydra-overlay__time">
            <strong>
              {new Date(now).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </strong>
            <span>
              {new Date(now).toLocaleDateString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          {!confirmExit ? (
            <button
              type="button"
              data-overlay-focusable
              className="hydra-overlay__exit"
              onClick={() => setConfirmExit(true)}
            >
              <Power size={16} /> Exit game
            </button>
          ) : (
            <div className="hydra-overlay__exit-confirm">
              <button type="button" data-overlay-focusable onClick={endGame}>
                End game
              </button>
              <button
                type="button"
                data-overlay-focusable
                onClick={() => setConfirmExit(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </section>

        <section className="hydra-overlay__game-brand">
          {game.logoImageUrl ? (
            <img src={game.logoImageUrl} alt={game.title} />
          ) : (
            <strong>{game.title}</strong>
          )}
        </section>

        <section className="hydra-overlay__close-area">
          <button
            type="button"
            data-overlay-focusable
            onClick={() => globalThis.electron.closeHydraOverlay()}
          >
            Back to game <X size={19} />
          </button>
        </section>
      </footer>
    </main>
  );
}
