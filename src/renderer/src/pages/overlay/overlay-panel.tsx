import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HomeIcon,
  PinIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";
import { AuthPage, normalizeOverlayBrowserUrl } from "@shared";

import { Button } from "@renderer/components";
import { setUserPreferences } from "@renderer/features";
import {
  useAppDispatch,
  useAppSelector,
  useUserDetails,
} from "@renderer/hooks";
import { useActiveTheme } from "@renderer/hooks/use-active-theme";
import type {
  OverlayBrowserState,
  OverlayGameInfo,
  OverlayPanel,
  OverlayPanelState,
  OverlayState,
} from "@types";

import { OverlayAchievements } from "./overlay-achievements";
import { OverlayChat } from "./overlay-chat";
import { useOverlayAchievements } from "./use-overlay-achievements";
import { LeaderboardSection } from "../game-details/leaderboard/leaderboard-section";
import { isLeaderboardShop } from "../game-details/leaderboard/game-leaderboard";

import "../../app.scss";
import "./overlay.scss";

const electron = globalThis.electron as Electron;

interface PanelActions {
  isPinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
}

interface PanelHeaderProps extends PanelActions {
  title: string;
  subtitle?: string | null;
}

function PanelHeader({
  title,
  subtitle,
  isPinned,
  onTogglePin,
  onClose,
}: Readonly<PanelHeaderProps>) {
  const { t } = useTranslation("overlay");
  const pinLabel = isPinned ? t("unpin_panel") : t("pin_panel");

  return (
    <header className="overlay-panel__header">
      <div className="overlay-panel__title-group">
        <span className="overlay-panel__title">{title}</span>
        {subtitle && (
          <span className="overlay-panel__subtitle" title={subtitle}>
            {subtitle}
          </span>
        )}
      </div>

      <div className="overlay-panel__actions">
        <button
          type="button"
          className={cn("overlay-panel__action", {
            "overlay-panel__action--active": isPinned,
          })}
          onClick={onTogglePin}
          title={pinLabel}
          aria-label={pinLabel}
          aria-pressed={isPinned}
        >
          <PinIcon size={14} />
        </button>
        <button
          type="button"
          className="overlay-panel__action overlay-panel__action--close"
          onClick={onClose}
          title={t("close_panel")}
          aria-label={t("close_panel")}
        >
          <XIcon size={14} />
        </button>
      </div>
    </header>
  );
}

interface PanelFrameProps extends PanelActions {
  title: string;
  subtitle?: string | null;
  children: ReactNode;
}

function PanelFrame({
  title,
  subtitle,
  children,
  ...actions
}: Readonly<PanelFrameProps>) {
  return (
    <div className="overlay-panel__frame">
      <PanelHeader title={title} subtitle={subtitle} {...actions} />
      <div className="overlay-panel__body">{children}</div>
    </div>
  );
}

interface ChatPanelContentProps extends PanelActions {
  onCloseOverlay: () => void;
}

function ChatPanelContent({
  onCloseOverlay,
  ...actions
}: Readonly<ChatPanelContentProps>) {
  const { t } = useTranslation("overlay");

  return (
    <PanelFrame title={t("chat")} {...actions}>
      <OverlayChat
        onClose={onCloseOverlay}
        showHeader={false}
        className="overlay-panel__chat"
      />
    </PanelFrame>
  );
}

interface AchievementsPanelContentProps extends PanelActions {
  game: OverlayGameInfo;
  retroAchievementsWebApiKey: string | null | undefined;
}

function AchievementsPanelContent({
  game,
  retroAchievementsWebApiKey,
  ...actions
}: Readonly<AchievementsPanelContentProps>) {
  const { t } = useTranslation("overlay");
  const { achievements } = useOverlayAchievements(
    game,
    retroAchievementsWebApiKey
  );

  const unlocked = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  return (
    <PanelFrame
      title={t("achievements")}
      subtitle={t("achievements_progress", {
        unlocked,
        total: achievements.length,
      })}
      {...actions}
    >
      <OverlayAchievements
        game={game}
        achievements={achievements}
        showHeader={false}
      />
    </PanelFrame>
  );
}

interface LeaderboardPanelContentProps extends PanelActions {
  game: OverlayGameInfo;
}

function LeaderboardPanelContent({
  game,
  ...actions
}: Readonly<LeaderboardPanelContentProps>) {
  const { t } = useTranslation("overlay");

  const content = isLeaderboardShop(game.shop) ? (
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
  ) : (
    <div className="overlay-panel__empty">
      <p>{t("leaderboard_unavailable")}</p>
    </div>
  );

  return (
    <PanelFrame title={t("leaderboard")} subtitle={game.title} {...actions}>
      {content}
    </PanelFrame>
  );
}

interface BrowserPanelContentProps extends PanelActions {
  game: OverlayGameInfo;
}

const EMPTY_BROWSER_STATE: OverlayBrowserState = {
  url: "",
  title: "",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
};

function BrowserPanelContent({
  game,
  ...actions
}: Readonly<BrowserPanelContentProps>) {
  const { t } = useTranslation("overlay");
  const [browserState, setBrowserState] =
    useState<OverlayBrowserState>(EMPTY_BROWSER_STATE);
  const [address, setAddress] = useState("");

  useEffect(() => {
    let cancelled = false;

    void electron.getOverlayBrowserState().then((state) => {
      if (cancelled) return;
      setBrowserState(state);
      setAddress(state.url);
    });

    const unsubscribe = electron.onOverlayBrowserState((state) => {
      setBrowserState(state);
      setAddress(state.url);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalized = normalizeOverlayBrowserUrl(address);
    if (!normalized) return;

    setAddress(normalized);
    void electron.navigateOverlayBrowser(normalized);
  };

  return (
    <PanelFrame
      title={t("browser")}
      subtitle={browserState.title || game.title}
      {...actions}
    >
      <div className="overlay-browser">
        <form className="overlay-browser__toolbar" onSubmit={handleSubmit}>
          <button
            type="button"
            className="overlay-browser__button"
            onClick={() => void electron.overlayBrowserGoBack()}
            disabled={!browserState.canGoBack}
            title={t("browser_back")}
            aria-label={t("browser_back")}
          >
            <ArrowLeftIcon size={14} />
          </button>
          <button
            type="button"
            className="overlay-browser__button"
            onClick={() => void electron.overlayBrowserGoForward()}
            disabled={!browserState.canGoForward}
            title={t("browser_forward")}
            aria-label={t("browser_forward")}
          >
            <ArrowRightIcon size={14} />
          </button>
          <button
            type="button"
            className={cn("overlay-browser__button", {
              "overlay-browser__button--loading": browserState.isLoading,
            })}
            onClick={() => void electron.overlayBrowserReload()}
            title={t("browser_reload")}
            aria-label={t("browser_reload")}
          >
            <SyncIcon size={14} />
          </button>

          <input
            className="overlay-browser__address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t("browser_address")}
            placeholder={t("browser_address")}
            spellCheck={false}
          />

          <button
            type="button"
            className="overlay-browser__button"
            onClick={() => void electron.overlayBrowserHome()}
            title={t("browser_home")}
            aria-label={t("browser_home")}
          >
            <HomeIcon size={14} />
          </button>
        </form>

        <div className="overlay-browser__view-spacer" aria-hidden="true" />
      </div>
    </PanelFrame>
  );
}

interface PanelSurfaceProps {
  panel: OverlayPanel;
  game: OverlayGameInfo;
  panelState: OverlayPanelState;
}

function PanelSurface({
  panel,
  game,
  panelState,
}: Readonly<PanelSurfaceProps>) {
  const { t } = useTranslation("overlay");
  const dispatch = useAppDispatch();
  const preferences = useAppSelector((state) => state.userPreferences.value);
  const { userDetails, fetchUserDetails, updateUserDetails } = useUserDetails();
  const [hasResolvedUser, setHasResolvedUser] = useState(() =>
    Boolean(userDetails)
  );

  useActiveTheme();

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

  const actions: PanelActions = {
    isPinned: panelState.isPinned,
    onTogglePin: () => {
      void electron.setOverlayPanelPinned(panel, !panelState.isPinned);
    },
    onClose: () => {
      void electron.closeOverlayPanel(panel);
    },
  };

  const closeOverlay = () => {
    void electron.closeOverlay();
  };

  if (panel === "browser") {
    return <BrowserPanelContent game={game} {...actions} />;
  }

  if (panel === "chat") {
    if (!hasResolvedUser) {
      return (
        <PanelFrame title={t("chat")} {...actions}>
          <div className="overlay-panel__empty">
            <p>{t("loading")}</p>
          </div>
        </PanelFrame>
      );
    }

    if (!userDetails) {
      return (
        <PanelFrame title={t("chat")} {...actions}>
          <div className="overlay-panel__empty">
            <p>{t("sign_in_required")}</p>
            <Button
              onClick={() => void electron.openAuthWindow(AuthPage.SignIn)}
            >
              {t("sign_in")}
            </Button>
          </div>
        </PanelFrame>
      );
    }

    return <ChatPanelContent onCloseOverlay={closeOverlay} {...actions} />;
  }

  if (panel === "leaderboard") {
    if (!hasResolvedUser) {
      return (
        <PanelFrame title={t("leaderboard")} {...actions}>
          <div className="overlay-panel__empty">
            <p>{t("loading")}</p>
          </div>
        </PanelFrame>
      );
    }

    return <LeaderboardPanelContent game={game} {...actions} />;
  }

  return (
    <AchievementsPanelContent
      game={game}
      retroAchievementsWebApiKey={preferences?.retroAchievementsWebApiKey}
      {...actions}
    />
  );
}

interface OverlayPanelPageProps {
  panel: OverlayPanel;
}

export function OverlayPanelPage({ panel }: Readonly<OverlayPanelPageProps>) {
  const [game, setGame] = useState<OverlayGameInfo | null>(null);
  const [panelState, setPanelState] = useState<OverlayPanelState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const applyState = (state: OverlayState) => {
      if (state.game) setGame(state.game);
    };

    void electron.getOverlayState().then((state) => {
      if (!cancelled) applyState(state);
    });
    const unsubscribe = electron.onOverlayState((state) => {
      applyState(state);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void electron.getOverlayPanelState(panel).then((state) => {
      if (!cancelled) setPanelState(state);
    });
    const unsubscribe = electron.onOverlayPanelState((state) => {
      if (state.panel === panel) setPanelState(state);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [panel]);

  useEffect(() => {
    if (!panelState?.isVisible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();

      if (panelState.isOverlayOpen) {
        void electron.closeOverlay();
      } else {
        void electron.closeOverlayPanel(panel);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panel, panelState?.isOverlayOpen, panelState?.isVisible]);

  const shouldRender =
    Boolean(panelState?.isWarm) &&
    Boolean(game) &&
    Boolean(
      panelState?.isVisible ||
        panelState?.isOpen ||
        panelState?.isOverlayOpen ||
        panelState?.isPinned
    );

  if (!panelState || !game || !shouldRender) return null;

  return (
    <div
      className={cn("overlay-panel", `overlay-panel--${panel}`, {
        "overlay-panel--visible": panelState.isVisible,
        "overlay-panel--closing":
          panelState.isOverlayClosing && !panelState.isPinned,
      })}
    >
      <PanelSurface panel={panel} game={game} panelState={panelState} />
    </div>
  );
}
