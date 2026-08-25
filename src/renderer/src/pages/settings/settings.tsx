import { useTranslation } from "react-i18next";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";
import { useMemo } from "react";
import "./settings.scss";
import {
  BellIcon,
  CloudIcon,
  DownloadIcon,
  GearIcon,
  LinkIcon,
  PlayIcon,
  PersonIcon,
  VideoIcon,
} from "@primer/octicons-react";
import { Gamepad2, Wrench } from "lucide-react";
import { SettingsContextGeneral } from "./settings-context-general";
import { SettingsContextDownloads } from "./settings-context-downloads";
import { SettingsContextDownloadSources } from "./settings-context-download-sources";
import { SettingsContextNotifications } from "./settings-context-notifications";
import { SettingsContextContentGameplay } from "./settings-context-content-gameplay";
import { SettingsContextIntegrations } from "./settings-context-integrations";
import { SettingsContextCompatibility } from "./settings-context-compatibility";
import { SettingsContextBigPicture } from "./settings-context-big-picture";
import { SettingsContextEmulation } from "./emulation/settings-context-emulation";
import { SettingsAppearance } from "./appearance/settings-appearance";
import { PaintbrushIcon } from "@primer/octicons-react";
import { SettingsAccount } from "./settings-account";

export default function Settings() {
  const { t } = useTranslation("settings");

  const categories = useMemo(
    () => [
      {
        id: "general" as const,
        label: t("general"),
        icon: <GearIcon size={16} />,
      },
      {
        id: "appearance" as const,
        label: t("appearance"),
        icon: <PaintbrushIcon size={16} />,
      },
      {
        id: "downloads" as const,
        label: t("downloads"),
        icon: <DownloadIcon size={16} />,
      },
      {
        id: "download_sources" as const,
        label: t("download_sources"),
        icon: <LinkIcon size={16} />,
      },
      {
        id: "notifications" as const,
        label: t("notifications"),
        icon: <BellIcon size={16} />,
      },
      {
        id: "content_gameplay" as const,
        label: t("content_gameplay"),
        icon: <PlayIcon size={16} />,
      },
      {
        id: "integrations" as const,
        label: t("integrations"),
        icon: <CloudIcon size={16} />,
      },
      {
        id: "account_privacy" as const,
        label: t("account_privacy", { defaultValue: "Account & Privacy" }),
        icon: <PersonIcon size={16} />,
      },
      {
        id: "compatibility" as const,
        label: t("compatibility"),
        icon: <Wrench size={16} />,
      },
      {
        id: "big_picture" as const,
        label: t("big_picture"),
        icon: <VideoIcon size={16} />,
      },
      {
        id: "emulation" as const,
        label: t("emulation"),
        icon: <Gamepad2 size={16} />,
      },
    ],
    [t]
  );

  return (
    <SettingsContextProvider>
      <SettingsContextConsumer>
        {({ currentCategoryId, setCurrentCategoryId, appearance }) => {
          const currentCategory =
            categories.find((category) => category.id === currentCategoryId) ??
            categories[0];
          const selectedCategoryId = currentCategory.id;

          const renderCategory = () => {
            if (selectedCategoryId === "general") {
              return <SettingsContextGeneral />;
            }

            if (selectedCategoryId === "appearance") {
              return <SettingsAppearance appearance={appearance} />;
            }

            if (selectedCategoryId === "downloads") {
              return <SettingsContextDownloads />;
            }

            if (selectedCategoryId === "download_sources") {
              return <SettingsContextDownloadSources />;
            }

            if (selectedCategoryId === "notifications") {
              return <SettingsContextNotifications />;
            }

            if (selectedCategoryId === "content_gameplay") {
              return <SettingsContextContentGameplay />;
            }

            if (selectedCategoryId === "integrations") {
              return <SettingsContextIntegrations />;
            }

            if (selectedCategoryId === "account_privacy") {
              return <SettingsAccount />;
            }

            if (selectedCategoryId === "compatibility") {
              return <SettingsContextCompatibility />;
            }

            if (selectedCategoryId === "big_picture") {
              return <SettingsContextBigPicture />;
            }

            if (selectedCategoryId === "emulation") {
              return <SettingsContextEmulation />;
            }

            return null;
          };

          return (
            <>
              <section className="settings__container">
                <div className="settings__content">
                  <aside className="settings__sidebar">
                    {categories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        className={`settings__sidebar-button ${
                          currentCategory.id === category.id
                            ? "settings__sidebar-button--active"
                            : ""
                        }`}
                        onClick={() => setCurrentCategoryId(category.id)}
                      >
                        <span className="settings__sidebar-button-icon">
                          {category.icon}
                        </span>
                        <span>{category.label}</span>
                      </button>
                    ))}
                  </aside>

                  <div className="settings__panel">
                    <h2>{currentCategory.label}</h2>
                    {renderCategory()}
                  </div>
                </div>
              </section>
            </>
          );
        }}
      </SettingsContextConsumer>
    </SettingsContextProvider>
  );
}
