import { Button } from "@renderer/components";
import { useTranslation } from "react-i18next";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsGeneral } from "./settings-general";
import { SettingsBehavior } from "./settings-behavior";
import torBoxLogo from "@renderer/assets/icons/torbox.webp";
import { SettingsDownloadSources } from "./settings-download-sources";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";
import { SettingsAccount } from "./settings-account";
import { useUserDetails } from "@renderer/hooks";
import { useMemo } from "react";
import "./settings.scss";
import { SettingsTorbox } from "./settings-torbox";

export default function Settings() {
  const { t } = useTranslation("settings");

  const { userDetails } = useUserDetails();

  const categories = useMemo(() => {
    const categories = [
      { tabLabel: t("general"), contentTitle: t("general") },
      { tabLabel: t("behavior"), contentTitle: t("behavior") },
      { tabLabel: t("download_sources"), contentTitle: t("download_sources") },
      {
        tabLabel: (
          <>
            <img src={torBoxLogo} alt="TorBox" style={{ width: 13 }} />
            Torbox
          </>
        ),
        contentTitle: "TorBox",
      },
      { tabLabel: "Real-Debrid", contentTitle: "Real-Debrid" },
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
              return <SettingsTorbox />;
            }

            if (currentCategoryIndex === 4) {
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
                      key={index}
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
