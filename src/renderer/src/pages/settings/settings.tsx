import * as styles from "./settings.css";
import { useTranslation } from "react-i18next";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsGeneral } from "./settings-general";
import { SettingsBehavior } from "./settings-behavior";

import { SettingsDownloadSources } from "./settings-download-sources";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";

export function Settings() {
  const { t } = useTranslation("settings");

  const categories = {
    [t("account")]: [t("my_profile"), t("friends")],
    Hydra: [t("general"), t("behavior"), t("download_sources"), "Real-Debrid"],
  };

  return (
    <SettingsContextProvider>
      <SettingsContextConsumer>
        {({ currentCategoryIndex, setCurrentCategoryIndex }) => {
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

            return <SettingsRealDebrid />;
          };

          return (
            <section className={styles.container}>
              <aside className={styles.sidebar}>
                {Object.entries(categories).map(([category, items]) => (
                  <div key={category} className={styles.menuGroup}>
                    <span className={styles.categoryTitle}>{category}</span>

                    <ul className={styles.menu}>
                      {items.map((item, index) => (
                        <li
                          key={`item-${index}`}
                          className={styles.menuItem({
                            active: currentCategoryIndex === index,
                          })}
                        >
                          <button
                            type="button"
                            className={styles.menuItemButton}
                            onClick={() => setCurrentCategoryIndex(index)}
                          >
                            {item}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </aside>

              <div className={styles.content}>
                <h2>{categories[currentCategoryIndex]}</h2>
                {renderCategory()}
              </div>
            </section>
          );
        }}
      </SettingsContextConsumer>
    </SettingsContextProvider>
  );
}
