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

import { useLocation, useNavigate } from "react-router-dom";
import {
  setSearch,
  clearSearch,
  setUserPreferences,
  setRepackersFriendlyNames,
  toggleDraggingDisabled,
} from "@renderer/features";

document.body.classList.add(themeClass);

export interface AppProps {
  children: React.ReactNode;
}

export function App({ children }: AppProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary } = useLibrary();

  const { monitorDownload, clearDownload, addPacket } = useDownload();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const search = useAppSelector((state) => state.search.value);
  const draggingDisabled = useAppSelector(
    (state) => state.window.draggingDisabled
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      monitorDownload();
    }, 1000); // 1000 ms = 1 segundo

    // Retorna uma função de limpeza para cancelar o intervalo quando o componente é desmontado
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    Promise.all([
      window.electron.getUserPreferences(),
      window.electron.getRepackersFriendlyNames(),
      updateLibrary(),
    ]).then(([preferences, repackersFriendlyNames]) => {
      dispatch(setUserPreferences(preferences));
      dispatch(setRepackersFriendlyNames(repackersFriendlyNames));
    });
  }, [navigate, location.pathname, dispatch, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onDownloadProgress(
      (downloadProgress) => {
        if (downloadProgress.game.progress === 1) {
          clearDownload();
          updateLibrary();
          return;
        }

        addPacket(downloadProgress);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [clearDownload, addPacket, updateLibrary]);

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
