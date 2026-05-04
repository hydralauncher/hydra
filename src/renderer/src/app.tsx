import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar, BottomPanel, Header } from "@renderer/components";
import { Toaster } from "sileo";
import {
  useAppDispatch,
  useAppSelector,
  useBigPicture,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useDownloadOptionsListener } from "@renderer/hooks/use-download-options-listener";
import { useGamepad } from "@renderer/hooks/use-gamepad";
import type { GamepadAction } from "@renderer/hooks/use-gamepad";

import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { setUserPreferences, toggleDraggingDisabled } from "@renderer/features";
import { useTranslation } from "react-i18next";
import { useSubscription } from "./hooks/use-subscription";
import { HydraCloudModal } from "./pages/shared-modals/hydra-cloud/hydra-cloud-modal";
import { ArchiveDeletionModal } from "./pages/downloads/archive-deletion-error-modal";
import { PasswordRequiredModal } from "./pages/downloads/password-required-modal";

import { injectCustomCss, removeCustomCss } from "./helpers";
import { levelDBService } from "./services/leveldb.service";
import type { GameShop, UserPreferences } from "@types";
import "./app.scss";

export interface AppProps {
  children: React.ReactNode;
}

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary } = useLibrary();
  const { enterBigPicture } = useBigPicture();

  useDownloadOptionsListener();

  const handleGamepadAction = useCallback(
    (action: GamepadAction) => {
      if (action.type === "menu") {
        enterBigPicture();
      }
    },
    [enterBigPicture]
  );

  useGamepad({
    enabled: true,
    onAction: handleGamepadAction,
  });

  const { t } = useTranslation("app");

  const { hasActiveSubscription } = useUserDetails();

  const { hideHydraCloudModal, isHydraCloudModalVisible, hydraCloudFeature } =
    useSubscription();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const draggingDisabled = useAppSelector(
    (state) => state.window.draggingDisabled
  );

  const { showSuccessToast } = useToast();

  const [showArchiveDeletionModal, setShowArchiveDeletionModal] =
    useState(false);
  const [archivePaths, setArchivePaths] = useState<string[]>([]);
  const [archiveTotalSize, setArchiveTotalSize] = useState(0);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordRequiredShop, setPasswordRequiredShop] =
    useState<GameShop | null>(null);
  const [passwordRequiredObjectId, setPasswordRequiredObjectId] = useState<
    string | null
  >(null);

  useEffect(() => {
    Promise.all([
      levelDBService.get("userPreferences", null, "json"),
      updateLibrary(),
    ]).then(([preferences]) => {
      dispatch(setUserPreferences(preferences as UserPreferences | null));
    });
  }, [navigate, location.pathname, dispatch, updateLibrary]);

  useEffect(() => {
    window.electron.importSteamGames().then(() => {
      updateLibrary();
    });
  }, [updateLibrary]);

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
    const allThemes = (await levelDBService.values("themes")) as {
      isActive?: boolean;
      code?: string;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);
    if (activeTheme?.code) {
      injectCustomCss(activeTheme.code);
    } else {
      removeCustomCss();
    }
  }, []);

  useEffect(() => {
    loadAndApplyTheme();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadAndApplyTheme();
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = window.electron.onSignIn(() => {
      showSuccessToast(t("successfully_signed_in"));
    });

    return () => unsubscribe();
  }, [t, showSuccessToast]);

  useEffect(() => {
    const listeners = [
      window.electron.onArchiveDeletionPrompt((paths, totalSizeInBytes) => {
        setArchivePaths(paths);
        setArchiveTotalSize(totalSizeInBytes);
        setShowArchiveDeletionModal(true);
      }),
      window.electron.onPasswordRequired((shop, objectId) => {
        setPasswordRequiredShop(shop);
        setPasswordRequiredObjectId(objectId);
        setShowPasswordModal(true);
      }),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  return (
    <DndProvider backend={HTML5Backend}>
      {window.electron.platform === "win32" && (
        <div className="title-bar">
          <h4>
            Hydra
            {hasActiveSubscription && (
              <span className="title-bar__cloud-text"> Cloud</span>
            )}
          </h4>
        </div>
      )}

      <Toaster position="bottom-right" offset={{ bottom: 44, right: 16 }} />

      <HydraCloudModal
        visible={isHydraCloudModalVisible}
        onClose={hideHydraCloudModal}
        feature={hydraCloudFeature}
      />

      <ArchiveDeletionModal
        visible={showArchiveDeletionModal}
        archivePaths={archivePaths}
        totalSizeInBytes={archiveTotalSize}
        onClose={() => setShowArchiveDeletionModal(false)}
      />

      <PasswordRequiredModal
        visible={showPasswordModal}
        shop={passwordRequiredShop}
        objectId={passwordRequiredObjectId}
        onClose={() => setShowPasswordModal(false)}
      />

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
    </DndProvider>
  );
}
