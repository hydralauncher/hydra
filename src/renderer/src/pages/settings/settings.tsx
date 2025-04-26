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
import { useFeature, useUserDetails } from "@renderer/hooks";
import { useMemo } from "react";
import "./settings.scss";
import { SettingsAppearance } from "./aparence/settings-appearance";
import { SettingsTorBox } from "./settings-torbox";

export default function Settings() {
  const { t } = useTranslation("settings");

  const { userDetails } = useUserDetails();

  const { isFeatureEnabled, Feature } = useFeature();

  const isTorBoxEnabled = isFeatureEnabled(Feature.TorBox);

  const categories = useMemo(() => {
    const categories = [
      { tabLabel: t("general"), contentTitle: t("general") },
      { tabLabel: t("behavior"), contentTitle: t("behavior") },
      { tabLabel: t("download_sources"), contentTitle: t("download_sources") },
      {
        tabLabel: t("appearance"),
        contentTitle: t("appearance"),
      },
      ...(isTorBoxEnabled
        ? [
            {
              tabLabel: "TorBox",
              contentTitle: "TorBox",
            },
          ]
        : []),
      { tabLabel: "Real-Debrid", contentTitle: "Real-Debrid" },
    ];

    if (userDetails)
      return [
        ...categories,
        { tabLabel: t("account"), contentTitle: t("account") },
      ];
    return categories;
  }, [userDetails, t, isTorBoxEnabled]);

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
              return <SettingsTorBox />;
            }

            if (currentCategoryIndex === 5) {
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
                      key={category.contentTitle}
                      theme={
                        currentCategoryIndex === index ? "primary" : "outline"
                      }
                      onClick={() => setCurrentCategoryIndex(index)}
                    >
                      {category.tabLabel}
                    </Button>
                  ))}
                </section>

                <h2>{categories[currentCategoryIndex].contentTitle}</h2>
                {renderCategory()}
              </div>
            </section>
          );
        }}
      </SettingsContextConsumer>
    </SettingsContextProvider>
  );
}
