import { useCallback, useEffect, useRef } from "react";
import { Sidebar, BottomPanel, Header, Toast } from "@renderer/components";

import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useDownloadOptionsListener } from "@renderer/hooks/use-download-options-listener";

import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  setUserPreferences,
  toggleDraggingDisabled,
  closeToast,
  setUserDetails,
  setProfileBackground,
  setGameRunning,
} from "@renderer/features";
import { useTranslation } from "react-i18next";
import { UserFriendModal } from "./pages/shared-modals/user-friend-modal";
import { useSubscription } from "./hooks/use-subscription";
import { HydraCloudModal } from "./pages/shared-modals/hydra-cloud/hydra-cloud-modal";

import {
  injectCustomCss,
  removeCustomCss,
  getAchievementSoundUrl,
  getAchievementSoundVolume,
} from "./helpers";
import "./app.scss";

export interface AppProps {
  children: React.ReactNode;
}

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary, library } = useLibrary();

  // Listen for new download options updates
  useDownloadOptionsListener();

  const { t } = useTranslation("app");

  const { clearDownload, setLastPacket } = useDownload();

  const {
    userDetails,
    hasActiveSubscription,
    isFriendsModalVisible,
    friendRequetsModalTab,
    friendModalUserId,
    hideFriendsModal,
    fetchUserDetails,
    updateUserDetails,
    clearUserDetails,
  } = useUserDetails();

  const { hideHydraCloudModal, isHydraCloudModalVisible, hydraCloudFeature } =
    useSubscription();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const draggingDisabled = useAppSelector(
    (state) => state.window.draggingDisabled
  );

  const toast = useAppSelector((state) => state.toast);

  const { showSuccessToast } = useToast();

  useEffect(() => {
    Promise.all([
      globalThis.electron.getUserPreferences(),
      updateLibrary(),
    ]).then(([preferences]) => {
      dispatch(setUserPreferences(preferences));
    });
  }, [navigate, location.pathname, dispatch, updateLibrary]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onDownloadProgress(
      (downloadProgress) => {
        if (downloadProgress?.progress === 1) {
          clearDownload();
          updateLibrary();
          return;
        }

        setLastPacket(downloadProgress);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [clearDownload, setLastPacket, updateLibrary]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onHardDelete(() => {
      updateLibrary();
    });

    return () => unsubscribe();
  }, [updateLibrary]);

  useEffect(() => {
    const cachedUserDetails = window.localStorage.getItem("userDetails");

    if (cachedUserDetails) {
      const { profileBackground, ...userDetails } =
        JSON.parse(cachedUserDetails);

      dispatch(setUserDetails(userDetails));
      dispatch(setProfileBackground(profileBackground));
    }

    fetchUserDetails()
      .then((response) => {
        if (response) {
          updateUserDetails(response);
          globalThis.electron.syncFriendRequests();
        }
      })
      .finally(() => {
        if (document.getElementById("external-resources")) return;

        const $script = document.createElement("script");
        $script.id = "external-resources";
        $script.src = `${import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL}/bundle.js?t=${Date.now()}`;
        document.head.appendChild($script);
      });
  }, [fetchUserDetails, updateUserDetails, dispatch]);

  const onSignIn = useCallback(() => {
    fetchUserDetails().then((response) => {
      if (response) {
        updateUserDetails(response);
        globalThis.electron.syncFriendRequests();
        showSuccessToast(t("successfully_signed_in"));
      }
    });
  }, [fetchUserDetails, t, showSuccessToast, updateUserDetails]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onGamesRunning((gamesRunning) => {
      if (gamesRunning.length) {
        const lastGame = gamesRunning[gamesRunning.length - 1];
        const libraryGame = library.find(
          (library) => library.id === lastGame.id
        );

        if (libraryGame) {
          dispatch(
            setGameRunning({
              ...libraryGame,
              sessionDurationInMillis: lastGame.sessionDurationInMillis,
            })
          );
          return;
        }
      }
      dispatch(setGameRunning(null));
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, library]);

  useEffect(() => {
    const listeners = [
      globalThis.electron.onSignIn(onSignIn),
      globalThis.electron.onLibraryBatchComplete(() => {
        updateLibrary();
      }),
      globalThis.electron.onSignOut(() => clearUserDetails()),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, [onSignIn, updateLibrary, clearUserDetails]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [location.pathname, location.search]);

  useEffect(() => {
    new MutationObserver(() => {
      const modal = document.body.querySelector("[data-hydra-dialog]");

      dispatch(toggleDraggingDisabled(Boolean(modal)));
    }).observe(document.body, {
      attributes: false,
      childList: true,
    });
  }, [dispatch, draggingDisabled]);

  const loadAndApplyTheme = useCallback(async () => {
    const activeTheme = await globalThis.electron.getActiveCustomTheme();
    if (activeTheme?.code) {
      injectCustomCss(activeTheme.code);
      const blocks: { name: string; content: string }[] = [];
      const disallowed = new Set([
        "hover",
        "active",
        "focus",
        "disabled",
        "before",
        "after",
        "visited",
        "checked",
        "placeholder",
        "focus-visible",
        "focus-within",
        "selection",
        "target",
      ]);
      const codeStr = activeTheme.code;
      let i = 0;
      while (i < codeStr.length) {
        if (codeStr[i] === ":") {
          let j = i + 1;
          while (j < codeStr.length && /\s/.test(codeStr[j])) j++;
          const start = j;
          while (j < codeStr.length && /[a-zA-Z0-9_-]/.test(codeStr[j])) j++;
          const name = codeStr.slice(start, j).toLowerCase();
          while (j < codeStr.length && /\s/.test(codeStr[j])) j++;
          if (codeStr[j] !== "{") {
            i++;
            continue;
          }
          let k = j + 1;
          let depth = 1;
          while (k < codeStr.length && depth > 0) {
            const ch = codeStr[k];
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
            k++;
          }
          const content = codeStr.slice(j + 1, k - 1);
          if (!disallowed.has(name)) {
            blocks.push({ name, content });
          }
          i = k;
        } else {
          i++;
        }
      }

      const parseVars = (content: string) => {
        const vars: { key: string; value: string }[] = [];
        const pieces = content.split(";");
        for (const piece of pieces) {
          const idx = piece.indexOf(":");
          if (idx === -1) continue;
          const left = piece.slice(0, idx).trim();
          const right = piece.slice(idx + 1).trim();
          if (left.startsWith("--") && right) {
            vars.push({ key: left, value: right });
          }
        }
        return vars;
      };

      const storedVariant = globalThis.localStorage.getItem(
        `customThemeVariant:${activeTheme.id}`
      );
      const rootBlock = blocks.find((b) => b.name === "root");
      const selectedBlock = storedVariant
        ? blocks.find((b) => b.name === storedVariant)
        : null;
      if (rootBlock) {
        parseVars(rootBlock.content).forEach(({ key, value }) => {
          document.documentElement.style.setProperty(key, value);
        });
      }
      if (selectedBlock && storedVariant !== "root") {
        parseVars(selectedBlock.content).forEach(({ key, value }) => {
          document.documentElement.style.setProperty(key, value);
        });
      }
    } else {
      removeCustomCss();
    }
  }, []);

  useEffect(() => {
    loadAndApplyTheme();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onCustomThemeUpdated(() => {
      loadAndApplyTheme();
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  const playAudio = useCallback(async () => {
    const soundUrl = await getAchievementSoundUrl();
    const volume = await getAchievementSoundVolume();
    const audio = new Audio(soundUrl);
    audio.volume = volume;
    audio.play();
  }, []);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onAchievementUnlocked(() => {
      playAudio();
    });

    return () => {
      unsubscribe();
    };
  }, [playAudio]);

  const handleToastClose = useCallback(() => {
    dispatch(closeToast());
  }, [dispatch]);

  return (
    <>
      {globalThis.electron.platform === "win32" && (
        <div className="title-bar">
          <h4>
            Hydra
            {hasActiveSubscription && (
              <span className="title-bar__cloud-text"> Cloud</span>
            )}
          </h4>
        </div>
      )}

      <Toast
        visible={toast.visible}
        title={toast.title}
        message={toast.message}
        type={toast.type}
        onClose={handleToastClose}
        duration={toast.duration}
      />

      <HydraCloudModal
        visible={isHydraCloudModalVisible}
        onClose={hideHydraCloudModal}
        feature={hydraCloudFeature}
      />

      {userDetails && (
        <UserFriendModal
          visible={isFriendsModalVisible}
          initialTab={friendRequetsModalTab}
          onClose={hideFriendsModal}
          userId={friendModalUserId}
        />
      )}

      <main>
        <Sidebar />

        <article className="container">
          <Header />

          <section
            ref={contentRef}
            id="scrollableDiv"
            className="container__content"
          >
            <Outlet />
          </section>
        </article>
      </main>

      <BottomPanel />
    </>
  );
}
