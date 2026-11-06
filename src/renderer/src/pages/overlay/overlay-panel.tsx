import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PinIcon, XIcon } from "@primer/octicons-react";
import cn from "classnames";
import { AuthPage } from "@shared";

import { Button } from "@renderer/components";
import { setUserPreferences } from "@renderer/features";
import {
  useAppDispatch,
  useAppSelector,
  useUserDetails,
} from "@renderer/hooks";
import { useActiveTheme } from "@renderer/hooks/use-active-theme";
import type {
  OverlayGameInfo,
  OverlayPanel,
  OverlayPanelState,
  OverlayState,
} from "@types";

import { OverlayAchievements } from "./overlay-achievements";
import { OverlayChat } from "./overlay-chat";
import { useOverlayAchievements } from "./use-overlay-achievements";

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
    let cancelled = false;

    void electron
      .getUserPreferences()
      .then((value) => {
        if (cancelled) return;
        dispatch(setUserPreferences(value));
      })
      .catch(() => undefined);

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
  }, [dispatch, fetchUserDetails, updateUserDetails]);

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

  if (!panelState?.isVisible || !game) return null;

  return (
    <div
      className={cn("overlay-panel", `overlay-panel--${panel}`, {
        "overlay-panel--closing":
          panelState.isOverlayClosing && !panelState.isPinned,
      })}
    >
      <PanelSurface panel={panel} game={game} panelState={panelState} />
    </div>
  );
}
