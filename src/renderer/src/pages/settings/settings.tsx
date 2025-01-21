import { Button } from "@renderer/components";
import { useTranslation } from "react-i18next";
import { SettingsRealDebrid } from "./settings-real-debrid";
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
import "./settings.scss";

export default function Settings() {
  const { t } = useTranslation("settings");
  const { userDetails } = useUserDetails();

  const categories = useMemo(() => {
    const categories = [
      t("general"),
      t("behavior"),
      t("download_sources"),
      "Real-Debrid",
    ];

    if (userDetails) return [...categories, t("account")];
    return categories;
  }, [userDetails, t]);

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

            if (currentCategoryIndex === 3) {
              return <SettingsRealDebrid />;
            }

            return <SettingsAccount />;
          };

          return (
            <section className="settings__container">
              <div className="settings__content">
                <section className="settings__categories">
                  {categories.map((category, index) => (
                    <Button
                      key={category}
                      theme={
                        currentCategoryIndex === index ? "primary" : "outline"
                      }
                      onClick={() => setCurrentCategoryIndex(index)}
                    >
                      {category}
                    </Button>
                  ))}
                </section>

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
