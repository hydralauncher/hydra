import { useTranslation } from "react-i18next";
import { SettingsGeneral } from "./settings-general";
import { SettingsBehavior } from "./settings-behavior";
import { SettingsDownloadSources } from "./settings-download-sources";
import { SettingsAchievements } from "./settings-achievements";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";
import { SettingsAccount } from "./settings-account";
import { useUserDetails } from "@renderer/hooks";
import { useMemo } from "react";
import "./settings.scss";
import { SettingsAppearance } from "./aparence/settings-appearance";
import { SettingsDebrid } from "./settings-debrid";
import cn from "classnames";
import {
  GearIcon,
  ToolsIcon,
  TrophyIcon,
  DownloadIcon,
  PaintbrushIcon,
  CloudIcon,
  PersonIcon,
} from "@primer/octicons-react";

export default function Settings() {
  const { t } = useTranslation("settings");

  const { userDetails } = useUserDetails();

  const categories = useMemo(() => {
    const categories = [
      { tabLabel: t("general"), contentTitle: t("general"), Icon: GearIcon },
      { tabLabel: t("behavior"), contentTitle: t("behavior"), Icon: ToolsIcon },
      {
        tabLabel: t("achievements"),
        contentTitle: t("achievements"),
        Icon: TrophyIcon,
      },
      {
        tabLabel: t("download_sources"),
        contentTitle: t("download_sources"),
        Icon: DownloadIcon,
      },
      {
        tabLabel: t("appearance"),
        contentTitle: t("appearance"),
        Icon: PaintbrushIcon,
      },
      { tabLabel: t("debrid"), contentTitle: t("debrid"), Icon: CloudIcon },
    ];

    if (userDetails)
      return [
        ...categories,
        {
          tabLabel: t("account"),
          contentTitle: t("account"),
          Icon: PersonIcon,
        },
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
              return <SettingsAchievements />;
            }

            if (currentCategoryIndex === 3) {
              return <SettingsDownloadSources />;
            }

            if (currentCategoryIndex === 4) {
              return <SettingsAppearance appearance={appearance} />;
            }

            if (currentCategoryIndex === 5) {
              return <SettingsDebrid />;
            }

            return <SettingsAccount />;
          };

          return (
            <section className="settings__container">
              <aside className="settings__sidebar">
                <ul className="settings__categories sidebar__menu">
                  {categories.map((category, index) => (
                    <li
                      key={category.contentTitle}
                      className={cn("sidebar__menu-item", {
                        "sidebar__menu-item--active":
                          currentCategoryIndex === index,
                      })}
                    >
                      <button
                        type="button"
                        className="sidebar__menu-item-button"
                        onClick={() => setCurrentCategoryIndex(index)}
                      >
                        <category.Icon size={16} />
                        <span className="sidebar__menu-item-button-label">
                          {category.tabLabel}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>

              <div className="settings__content">
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
