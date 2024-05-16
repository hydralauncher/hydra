import { useCallback, useEffect, useRef, useState } from "react";

import { Sidebar, BottomPanel, Header } from "@renderer/components";

import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useLibrary,
} from "@renderer/hooks";

import * as styles from "./app.css";
import { vars } from "./theme.css";

import { useLocation, useNavigate } from "react-router-dom";
import {
  setSearch,
  clearSearch,
  setUserPreferences,
  toggleDraggingDisabled,
} from "@renderer/features";
import { GameStatusHelper } from "@shared";
import { Theme } from "@types";
import { setElementVars } from "@vanilla-extract/dynamic";

export interface AppProps {
  children: React.ReactNode;
}

export function App({ children }: AppProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary } = useLibrary();

  const { clearDownload, setLastPacket } = useDownload();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const search = useAppSelector((state) => state.search.value);
  const draggingDisabled = useAppSelector(
    (state) => state.window.draggingDisabled
  );

  const [themeLoaded, setThemeLoaded] = useState(false);

  useEffect(() => {
    Promise.all([window.electron.getUserPreferences(), updateLibrary()]).then(
      ([preferences]) => {
        dispatch(setUserPreferences(preferences));
        if (!themeLoaded) {
          const storedTheme = localStorage.getItem("theme");
          if (storedTheme) {
            const theme = JSON.parse(storedTheme) as Theme;
            applyTheme(theme);
            setThemeLoaded(true);
          }
        }
      }
    );
  }, [navigate, location.pathname, dispatch, updateLibrary, themeLoaded]);

  const applyTheme = (theme: Theme) => {
    setElementVars(document.body, {
      [vars.color.background]: theme.scheme.background,
      [vars.color.darkBackground]: theme.scheme.darkBackground,
      [vars.color.muted]: theme.scheme.muted,
      [vars.color.bodyText]: theme.scheme.bodyText,
      [vars.color.border]: theme.scheme.border,
    });
  };

  useEffect(() => {
    const unsubscribe = window.electron.onDownloadProgress(
      (downloadProgress) => {
        if (GameStatusHelper.isReady(downloadProgress.game.status)) {
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

  const handleSearch = useCallback(
    (query: string) => {
      dispatch(setSearch(query));

      if (query === "") {
        navigate(-1);
        return;
      }

      const searchParams = new URLSearchParams({
        query,
      });

      navigate(`/search?${searchParams.toString()}`, {
        replace: location.pathname.startsWith("/search"),
      });
    },
    [dispatch, location.pathname, navigate]
  );

  const handleClear = useCallback(() => {
    dispatch(clearSearch());
    navigate(-1);
  }, [dispatch, navigate]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [location.pathname, location.search]);

  useEffect(() => {
    new MutationObserver(() => {
      const modal = document.body.querySelector("[role=modal]");

      dispatch(toggleDraggingDisabled(Boolean(modal)));
    }).observe(document.body, {
      attributes: false,
      childList: true,
    });
  }, [dispatch, draggingDisabled]);

  return (
    <>
      {window.electron.platform === "win32" && (
        <div className={styles.titleBar}>
          <h4>Hydra</h4>
        </div>
      )}

      <main>
        <Sidebar />

        <article className={styles.container}>
          <Header
            onSearch={handleSearch}
            search={search}
            onClear={handleClear}
          />

          <section ref={contentRef} className={styles.content}>
            {children}
          </section>
        </article>
      </main>
      <BottomPanel />
    </>
  );
}
