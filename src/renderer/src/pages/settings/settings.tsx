import { useTranslation } from "react-i18next";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";
import { SettingsAccount } from "./settings-account";
import { useUserDetails } from "@renderer/hooks";
import { Fragment, useEffect, useMemo, useRef } from "react";
import "./settings.scss";
import {
  BellIcon,
  CloudIcon,
  DownloadIcon,
  GearIcon,
  PlayIcon,
  VideoIcon,
  ShieldCheckIcon,
  XIcon,
} from "@primer/octicons-react";
import { Gamepad2, Wrench } from "lucide-react";
import { SettingsContextGeneral } from "./settings-context-general";
import { SettingsContextDownloads } from "./settings-context-downloads";
import { SettingsContextNotifications } from "./settings-context-notifications";
import { SettingsContextContentGameplay } from "./settings-context-content-gameplay";
import { SettingsContextIntegrations } from "./settings-context-integrations";
import { SettingsContextCompatibility } from "./settings-context-compatibility";
import { SettingsContextBigPicture } from "./settings-context-big-picture";
import { SettingsContextEmulation } from "./emulation/settings-context-emulation";

export interface SettingsProps {
  onClose?: () => void;
}

export default function Settings({ onClose }: Readonly<SettingsProps>) {
  const { t } = useTranslation(["settings", "modal"]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { userDetails } = useUserDetails();

  useEffect(() => {
    if (!onClose) return;

    const isTopMostDialog = () => {
      const openDialogs = document.querySelectorAll("[role=dialog]");

      return (
        openDialogs.length &&
        openDialogs[openDialogs.length - 1] === containerRef.current
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopMostDialog()) onClose();
    };

    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const categories = useMemo(
    () => [
      {
        id: "general" as const,
        label: t("general"),
        icon: <GearIcon size={16} />,
      },
      {
        id: "downloads" as const,
        label: t("downloads"),
        icon: <DownloadIcon size={16} />,
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
        id: "compatibility" as const,
        label: t("compatibility"),
        icon: <Wrench size={16} />,
      },
      ...(userDetails
        ? [
            {
              id: "account_privacy" as const,
              label: `${t("account")} & ${t("privacy")}`,
              icon: <ShieldCheckIcon size={16} />,
            },
          ]
        : []),
      {
        id: "big_picture" as const,
        label: t("big_picture"),
        icon: <VideoIcon size={16} />,
      },
      {
        id: "emulation" as const,
        label: t("emulation"),
        icon: <Gamepad2 size={16} />,
        group: "classics" as const,
        badge: t("new_badge"),
      },
    ],
    [t, userDetails]
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
              return <SettingsContextGeneral appearance={appearance} />;
            }

            if (selectedCategoryId === "downloads") {
              return <SettingsContextDownloads />;
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

            if (selectedCategoryId === "compatibility") {
              return <SettingsContextCompatibility />;
            }

            if (selectedCategoryId === "big_picture") {
              return <SettingsContextBigPicture />;
            }

            if (selectedCategoryId === "emulation") {
              return <SettingsContextEmulation />;
            }

            return <SettingsAccount />;
          };

          const contentBody = (
            <>
              <div className="settings__content">
                {onClose && (
                  <button
                    type="button"
                    className="settings__close-button"
                    onClick={onClose}
                    aria-label={t("modal:close")}
                  >
                    <XIcon size={24} />
                  </button>
                )}

                <aside className="settings__sidebar">
                  {categories.map((category, index) => {
                    const prevGroup =
                      index > 0
                        ? (categories[index - 1] as { group?: string }).group
                        : undefined;
                    const currentGroup = (category as { group?: string }).group;
                    const badge = (category as { badge?: string }).badge;
                    const showGroupHeader =
                      currentGroup && currentGroup !== prevGroup;

                    return (
                      <Fragment key={category.id}>
                        {showGroupHeader && (
                          <div className="settings__sidebar-group">
                            <div className="settings__sidebar-divider" />
                            <span className="settings__sidebar-group-label">
                              {currentGroup === "classics"
                                ? t("classics_group")
                                : currentGroup}
                            </span>
                          </div>
                        )}
                        <button
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
                          <span className="settings__sidebar-button-label">
                            {category.label}
                          </span>
                          {badge && (
                            <span className="settings__sidebar-button-badge">
                              {badge}
                            </span>
                          )}
                        </button>
                      </Fragment>
                    );
                  })}
                </aside>

                <div className="settings__panel">
                  {selectedCategoryId !== "emulation" && (
                    <h2>{currentCategory.label}</h2>
                  )}
                  {renderCategory()}
                </div>
              </div>
            </>
          );

          if (onClose) {
            return (
              <div className="settings__overlay">
                <div
                  ref={containerRef}
                  className="settings__container"
                  role="dialog"
                  aria-modal
                  data-hydra-dialog
                >
                  {contentBody}
                </div>
              </div>
            );
          }

          return (
            <section className="settings__container">{contentBody}</section>
          );
        }}
      </SettingsContextConsumer>
    </SettingsContextProvider>
  );
}
