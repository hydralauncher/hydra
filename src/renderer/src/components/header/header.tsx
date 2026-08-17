import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useId, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useGamepad, useGamepadConnected } from "@renderer/hooks/use-gamepad";
import { GamepadHint } from "@renderer/components/gamepad-hint/gamepad-hint";
import {
  ArrowLeftIcon,
  BellIcon,
  SearchIcon,
  SyncIcon,
  DownloadIcon,
} from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";

import {
  useAppDispatch,
  useAppSelector,
  useSearchHistory,
  useSearchSuggestions,
  useUserDetails,
  useDownload,
} from "@renderer/hooks";

import "./header.scss";
import { ScanGamesModal, type ScanResult } from "./scan-games-modal";
import { setFilters, setLibrarySearchQuery } from "@renderer/features";
import cn from "classnames";
import { SearchDropdown, Modal } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import type { GameShop } from "@types";
import { routes as navRoutes } from "../sidebar/routes";
import { Avatar } from "../avatar/avatar";
import { AnimatedBorder } from "../animated-border/animated-border";
import { GradualBlur } from "../ui/gradual-blur";
import { AuthPage } from "@shared";
import { NotificationsSidebar } from "../notifications-sidebar/notifications-sidebar";
import Downloads from "../../pages/downloads/downloads";
import { CatalogueHeader } from "../../pages/catalogue/catalogue-header";

export function Header() {
  const isGamepadConnected = useGamepadConnected();
  const scanButtonTooltipId = useId();

  const { lastPacket } = useDownload();
  const [downloadsModalOpen, setDownloadsModalOpen] = useState(false);

  const hasActiveDownload = !!lastPacket?.gameId;

  const navigate = useNavigate();
  const location = useLocation();

  const currentRouteIndex = navRoutes.findIndex(({ path }) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path)
  );

  const navigatePrev = useCallback(() => {
    const idx =
      currentRouteIndex <= 0 ? navRoutes.length - 1 : currentRouteIndex - 1;
    navigate(navRoutes[idx].path);
  }, [currentRouteIndex, navigate]);

  const navigateNext = useCallback(() => {
    const idx =
      currentRouteIndex >= navRoutes.length - 1 ? 0 : currentRouteIndex + 1;
    navigate(navRoutes[idx].path);
  }, [currentRouteIndex, navigate]);

  useGamepad({
    priority: 5,
    onButton: {
      LB: () => {
        navigatePrev();
        return true;
      },
      RB: () => {
        navigateNext();
        return true;
      },
      X: () => {
        handleToggleSearch();
        window.electron.showVirtualKeyboard?.();
        return true;
      },
      Y: () => {
        handleProfileClick();
        return true;
      },
    },
  });

  useEffect(() => {
    const handleOpenNotifs = () => {
      setNotifSidebarOpen((o) => {
        if (!o) window.dispatchEvent(new CustomEvent("hydra:close-sidebar"));
        return !o;
      });
    };
    const handleCloseNotifs = () => setNotifSidebarOpen(false);

    window.addEventListener(
      "hydra:open-notifications",
      handleOpenNotifs as EventListener
    );
    window.addEventListener(
      "hydra:close-notifications",
      handleCloseNotifs as EventListener
    );

    return () => {
      window.removeEventListener(
        "hydra:open-notifications",
        handleOpenNotifs as EventListener
      );
      window.removeEventListener(
        "hydra:close-notifications",
        handleCloseNotifs as EventListener
      );
    };
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();

  const [notifSidebarOpen, setNotifSidebarOpen] = useState(false);

  const [avatarDecorOptions, setAvatarDecorOptions] = useState({
    border: localStorage.getItem("hydra_avatar_border") || "none",
    speed: Number(localStorage.getItem("hydra_avatar_beam_speed")) || 6,
    color: localStorage.getItem("hydra_avatar_beam_color") || "#ef4444",
    length: Number(localStorage.getItem("hydra_avatar_beam_length")) || 25,
    chaos: Number(localStorage.getItem("hydra_avatar_beam_chaos")) || 0.12,
  });

  useEffect(() => {
    const handleAvatarUpdate = () => {
      setAvatarDecorOptions({
        border: localStorage.getItem("hydra_avatar_border") || "none",
        speed: Number(localStorage.getItem("hydra_avatar_beam_speed")) || 6,
        color: localStorage.getItem("hydra_avatar_beam_color") || "#ef4444",
        length: Number(localStorage.getItem("hydra_avatar_beam_length")) || 25,
        chaos: Number(localStorage.getItem("hydra_avatar_beam_chaos")) || 0.12,
      });
    };
    window.addEventListener("avatar_style_update", handleAvatarUpdate);
    return () =>
      window.removeEventListener("avatar_style_update", handleAvatarUpdate);
  }, []);

  const { draggingDisabled } = useAppSelector((state) => state.window);

  const { userDetails } = useUserDetails();
  const { hasActiveSubscription } = useUserDetails();

  const handleProfileClick = () => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }
    navigate(`/profile/${userDetails.id}`);
  };

  const isHomePage = location.pathname === "/";
  const isOnLibraryPage = location.pathname.startsWith("/library");
  const isOnCataloguePage = location.pathname.startsWith("/catalogue");
  const isGamePage = location.pathname.startsWith("/game");
  const isSettingsPage = location.pathname.startsWith("/settings");
  const isDownloadsPage = location.pathname.startsWith("/downloads");

  const openedFolderName = "";

  const dispatch = useAppDispatch();

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchInputValue, setSearchInputValue] = useState("");
  const [showScanModal, setShowScanModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const { t } = useTranslation("header");

  const { addToHistory, removeFromHistory, clearHistory, getRecentHistory } =
    useSearchHistory();

  const { suggestions, isLoading: isLoadingSuggestions } = useSearchSuggestions(
    searchInputValue,
    isOnLibraryPage,
    isSearchOpen
  );

  const historyItems = getRecentHistory(
    isOnLibraryPage ? "library" : "catalogue",
    10
  );

  const handleBackButtonClick = () => {
    if (
      searchParams.has("collection") &&
      searchParams.get("collection") !== "new" &&
      searchParams.get("action") !== "edit"
    ) {
      searchParams.delete("collection");
      setSearchParams(searchParams, { replace: true });
    } else {
      navigate(-1);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchInputValue(value);
  };

  const executeSearch = (query: string) => {
    const context = isOnLibraryPage ? "library" : "catalogue";
    if (query.trim()) {
      addToHistory(query, context);
    }
    if (isOnLibraryPage) {
      dispatch(setLibrarySearchQuery(query.slice(0, 255)));
    } else {
      dispatch(setFilters({ title: query.slice(0, 255) }));
      if (!location.pathname.startsWith("/catalogue")) {
        navigate("/catalogue");
      }
    }
    setIsSearchOpen(false);
  };

  const handleSelectHistory = (query: string) => {
    setSearchInputValue(query);
  };

  const handleSelectSuggestion = (suggestion: {
    title: string;
    objectId: string;
    shop: GameShop;
  }) => {
    setIsSearchOpen(false);
    navigate(buildGameDetailsPath(suggestion));
  };

  const handleRemoveHistoryItem = (query: string) => {
    removeFromHistory(query);
  };

  const handleClearHistory = () => {
    clearHistory();
  };

  const handleStartScan = async (
    additionalDirectories: string[],
    includeDefaultDirectories: boolean,
    addGamesToLibrary: boolean
  ) => {
    if (isScanning) return;

    setIsScanning(true);
    setScanResult(null);

    try {
      const result = await window.electron.scanInstalledGames(
        additionalDirectories,
        includeDefaultDirectories,
        addGamesToLibrary
      );
      setScanResult(result as any);
    } finally {
      setIsScanning(false);
    }
  };

  const handleCancelScan = () => {
    setIsScanning(false);
  };

  const handleClearScanResult = () => {
    setScanResult(null);
  };

  useEffect(() => {
    if (searchParams.get("openScanModal") === "true") {
      setShowScanModal(true);
      searchParams.delete("openScanModal");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleToggleSearch = () => {
    setIsSearchOpen((prev) => !prev);
  };

  const isMainPage =
    location.pathname === "/" ||
    location.pathname === "/catalogue" ||
    location.pathname === "/library" ||
    location.pathname === "/downloads" ||
    location.pathname === "/settings";

  const showBackButton =
    !isMainPage || !!openedFolderName || searchParams.has("collection");

  return (
    <>
      {!(isHomePage || isGamePage || isSettingsPage || isDownloadsPage) && (
        <GradualBlur
          position="top"
          height="130px"
          strength={2}
          divCount={8}
          curve="linear"
          exponential
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            zIndex: 9,
            pointerEvents: "none",
          }}
        />
      )}

      <header
        data-gamepad-ignore="true"
        className={cn("header", {
          "header--dragging-disabled": draggingDisabled,
          "header--search-open": isSearchOpen,
          "header--catalogue": isOnCataloguePage,
          "header--transparent": isOnLibraryPage || isDownloadsPage,
          "header--home": isHomePage,
        })}
      >
        <div className="header__row">
          <section className="header__section header__section--left">
            <button
              type="button"
              className={cn("header__back-button", {
                "header__back-button--enabled": showBackButton,
              })}
              onClick={handleBackButtonClick}
              disabled={!showBackButton}
            >
              <ArrowLeftIcon />
            </button>
          </section>

          <nav className="header__nav" data-gamepad-ignore="true">
            {isGamepadConnected && <GamepadHint label="LB" position="left" />}
            {navRoutes.map(({ path, nameKey }) => (
              <button
                key={path}
                type="button"
                className={cn("header__nav-item", {
                  "header__nav-item--active":
                    path === "/"
                      ? location.pathname === "/"
                      : location.pathname.startsWith(path),
                })}
                onClick={() => navigate(path)}
              >
                {t(nameKey, { ns: "sidebar" })}
              </button>
            ))}
            {isGamepadConnected && <GamepadHint label="RB" position="right" />}
          </nav>

          <section className="header__section header__section--right">
            {isOnLibraryPage && window.electron.platform === "win32" && (
              <button
                type="button"
                className={cn("header__action-button", {
                  "header__action-button--scanning": isScanning,
                })}
                onClick={() => setShowScanModal(true)}
                data-tooltip-id={scanButtonTooltipId}
                data-tooltip-content={t("scan_games_tooltip")}
                data-tooltip-place="bottom"
              >
                <SyncIcon size={16} />
              </button>
            )}

            {!isOnLibraryPage && (
              <button
                type="button"
                className="header__action-button"
                onClick={handleToggleSearch}
              >
                <SearchIcon size={16} />
              </button>
            )}

            {hasActiveDownload && (
              <button
                type="button"
                className="header__action-button header__action-button--downloading"
                onClick={() => setDownloadsModalOpen(true)}
                title={t("downloads", {
                  ns: "sidebar",
                  defaultValue: "Downloads",
                })}
              >
                <DownloadIcon size={16} />
              </button>
            )}

            <button
              type="button"
              className="header__action-button"
              onClick={() =>
                setNotifSidebarOpen((o) => {
                  if (!o)
                    window.dispatchEvent(
                      new CustomEvent("hydra:close-sidebar")
                    );
                  return !o;
                })
              }
              title={t("notifications", { ns: "sidebar" })}
            >
              <BellIcon size={16} />
            </button>

            <button
              type="button"
              className="header__profile-button"
              onClick={handleProfileClick}
            >
              <AnimatedBorder
                borderWidth={1}
                containerSize={28}
                styleName={avatarDecorOptions.border as any}
                beamSpeed={avatarDecorOptions.speed}
                beamColor={avatarDecorOptions.color}
                beamLength={avatarDecorOptions.length}
                beamChaos={avatarDecorOptions.chaos}
              >
                <Avatar
                  size={28}
                  src={userDetails?.profileImageUrl}
                  alt={userDetails?.displayName}
                />
              </AnimatedBorder>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  paddingLeft: 4,
                }}
              >
                <span
                  className="header__profile-label"
                  style={{ lineHeight: 1 }}
                >
                  {userDetails?.displayName || t("sign_in", { ns: "sidebar" })}
                </span>
                {hasActiveSubscription && (
                  <span className="header__profile-cloud-badge">CLOUD</span>
                )}
              </div>
            </button>
          </section>
        </div>

        {isOnCataloguePage && <CatalogueHeader />}
      </header>

      {isOnLibraryPage && window.electron.platform === "win32" && (
        <Tooltip id={scanButtonTooltipId} style={{ zIndex: 9999 }} />
      )}

      <SearchDropdown
        visible={isSearchOpen}
        historyItems={historyItems}
        suggestions={suggestions}
        isLoadingSuggestions={isLoadingSuggestions}
        onSelectHistory={handleSelectHistory}
        onSelectSuggestion={handleSelectSuggestion}
        onRemoveHistoryItem={handleRemoveHistoryItem}
        onClearHistory={handleClearHistory}
        onClose={() => setIsSearchOpen(false)}
        searchValue={searchInputValue}
        onSearchChange={handleSearchChange}
        onExecuteSearch={() =>
          searchInputValue.trim() && executeSearch(searchInputValue)
        }
        placeholder={isOnLibraryPage ? t("search_library") : t("search")}
      />

      <ScanGamesModal
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        isScanning={isScanning}
        scanResult={scanResult}
        onStartScan={handleStartScan}
        onCancelScan={handleCancelScan}
        onClearResult={handleClearScanResult}
      />

      <NotificationsSidebar
        open={notifSidebarOpen}
        onClose={() => setNotifSidebarOpen(false)}
      />

      <Modal
        visible={downloadsModalOpen}
        title={t("downloads", { ns: "sidebar", defaultValue: "Downloads" })}
        onClose={() => setDownloadsModalOpen(false)}
        large
      >
        {downloadsModalOpen && <Downloads />}
      </Modal>
    </>
  );
}
