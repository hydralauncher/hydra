import { useCallback, useEffect, useRef } from "react";

import { Sidebar, BottomPanel, Header } from "@renderer/components";

import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useLibrary,
} from "@renderer/hooks";

import * as styles from "./app.css";
import { themeClass } from "./theme.css";

import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  setSearch,
  clearSearch,
  setUserPreferences,
  toggleDraggingDisabled,
} from "@renderer/features";
import { GameStatusHelper } from "@shared";

document.body.classList.add(themeClass);

export interface AppProps {
  children: React.ReactNode;
}

export function App() {
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

  useEffect(() => {
    Promise.all([window.electron.getUserPreferences(), updateLibrary()]).then(
      ([preferences]) => {
        dispatch(setUserPreferences(preferences));
      }
    );
  }, [navigate, location.pathname, dispatch, updateLibrary]);

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
            <Outlet />
          </section>
        </article>
      </main>
      <BottomPanel />
    </>
  );
}
