import { useTranslation } from "react-i18next";
import { SettingsGeneral } from "./settings-general";
import { SettingsBehavior } from "./settings-behavior";
import { SettingsDownloadSources } from "./settings-download-sources";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";
import { SettingsAccount } from "./settings-account";
import { useUserDetails } from "@renderer/hooks";
import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./settings.scss";
import { SettingsAppearance } from "./appearance/settings-appearance";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsBackups } from "./settings-backups";
import { SettingsStorage } from "./settings-storage";
import { SettingsBeta } from "./settings-beta";
import { SettingsNewsFeeds } from "./settings-news-feeds";

export default function Settings() {
  const { t } = useTranslation("settings");

  const { userDetails } = useUserDetails();

  const categories = useMemo(() => {
    const categories = [
      { tabLabel: t("general"), contentTitle: t("general") },
      { tabLabel: t("behavior"), contentTitle: t("behavior") },
      { tabLabel: t("download_sources"), contentTitle: t("download_sources") },
      {
        tabLabel: t("appearance"),
        contentTitle: t("appearance"),
      },
      { tabLabel: t("debrid"), contentTitle: t("debrid") },
      { tabLabel: t("backups"), contentTitle: t("backups") },
      { tabLabel: t("storage"), contentTitle: t("storage") },
      { tabLabel: t("news_feeds"), contentTitle: t("news_feeds") },
      { tabLabel: t("beta"), contentTitle: t("beta") },
    ];

    if (userDetails)
      return [
        ...categories,
        { tabLabel: t("account"), contentTitle: t("account") },
      ];
    return categories;
  }, [userDetails, t]);

  return (
    <SettingsContextProvider>
      <SettingsContextConsumer>
        {({ currentCategoryIndex, setCurrentCategoryIndex, appearance }) => {
          const renderCategory = () => {
            if (currentCategoryIndex === 0) {
              return <SettingsGeneral />;
            }

            if (currentCategoryIndex === 1) {
              return <SettingsBehavior />;
            }

            if (currentCategoryIndex === 2) {
              return <SettingsDownloadSources />;
            }

            if (currentCategoryIndex === 3) {
              return <SettingsAppearance appearance={appearance} />;
            }

            if (currentCategoryIndex === 4) {
              return <SettingsDebrid />;
            }

            if (currentCategoryIndex === 5) {
              return <SettingsBackups />;
            }

            if (currentCategoryIndex === 6) {
              return <SettingsStorage />;
            }

            if (currentCategoryIndex === 7) {
              return <SettingsNewsFeeds />;
            }

            if (currentCategoryIndex === 8) {
              return <SettingsBeta />;
            }

            return <SettingsAccount />;
          };

          return (
            <section className="settings__container">
              <div className="settings__content">
                <div className="settings__tabs">
                  {categories.map((category, index) => (
                    <div
                      key={category.contentTitle}
                      className="settings__tab-wrapper"
                    >
                      <button
                        type="button"
                        className={`settings__tab ${currentCategoryIndex === index ? "settings__tab--active" : ""}`}
                        onClick={() => setCurrentCategoryIndex(index)}
                      >
                        {category.tabLabel}
                      </button>
                      {currentCategoryIndex === index && (
                        <motion.div
                          className="settings__tab-underline"
                          layoutId="settings-tab-underline"
                          transition={{
                            type: "spring",
                            stiffness: 300,
                            damping: 30,
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentCategoryIndex}
                    className="settings__tab-content"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.15 }}
                  >
                    {renderCategory()}
                  </motion.div>
                </AnimatePresence>
              </div>
            </section>
          );
        }}
      </SettingsContextConsumer>
    </SettingsContextProvider>
  );
}
