import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, SearchIcon } from "@primer/octicons-react";

import { useAppSelector } from "@renderer/hooks";

import * as styles from "./header.css";
import { AutoUpdateSubHeader } from "./auto-update-sub-header";
import { Button } from "../button/button";

const pathTitle: Record<string, string> = {
  "/": "home",
  "/catalogue": "catalogue",
  "/downloads": "downloads",
  "/settings": "settings",
};

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();

  const { headerTitle, draggingDisabled } = useAppSelector(
    (state) => state.window
  );

  const { t } = useTranslation("header");

  const title = useMemo(() => {
    if (location.pathname.startsWith("/game")) return headerTitle;
    if (location.pathname.startsWith("/achievements")) return headerTitle;
    if (location.pathname.startsWith("/profile")) return headerTitle;
    if (location.pathname.startsWith("/search")) return t("search_results");

    return t(pathTitle[location.pathname]);
  }, [location.pathname, headerTitle, t]);

  const showSearchButton = useMemo(() => {
    return location.pathname.startsWith("/catalogue");
  }, [location.pathname]);

  const handleBackButtonClick = () => {
    navigate(-1);
  };

  return (
    <>
      <header
        className={styles.header({
          draggingDisabled,
          isWindows: window.electron.platform === "win32",
        })}
      >
        <section className={styles.section} style={{ flex: 1 }}>
          <button
            type="button"
            className={styles.backButton({
              enabled: location.key !== "default",
            })}
            onClick={handleBackButtonClick}
            disabled={location.key === "default"}
          >
            <ArrowLeftIcon />
          </button>

          <h3
            className={styles.title({
              hasBackButton: location.key !== "default",
            })}
          >
            {title}
          </h3>
        </section>

        <section className={styles.section}>
          <Button
            theme="outline"
            className={styles.searchButton({ hidden: showSearchButton })}
            onClick={() => navigate("/catalogue?search=true")}
          >
            <SearchIcon />
            {t("search")}
          </Button>
        </section>
      </header>
      <AutoUpdateSubHeader />
    </>
  );
}
