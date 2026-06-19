import "./compatibility.scss";

import type { ProtonVersion } from "@types";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { GAMEMODE_SITE_URL, MANGOHUD_SITE_URL } from "@shared";

import { Button, Checkbox, Radio, VerticalFocusGroup } from "../../components";
import { useUserPreferences, useBigPictureToast } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  COMPATIBILITY_COMMON_REDIST_BUTTON_ID,
  COMPATIBILITY_GAMEMODE_FOCUS_ID,
  COMPATIBILITY_MANGOHUD_FOCUS_ID,
  COMPATIBILITY_PROTON_OPTION_AUTO_FOCUS_ID,
  COMPATIBILITY_SECTION_REGION_ID,
  getCompatibilityProtonOptionFocusId,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface SettingsSectionProps {
  className?: string;
}

interface CompatibilityForm {
  defaultProtonPath: string;
  autoRunGamemode: boolean;
  autoRunMangohud: boolean;
}

interface CompatibilityPreferenceValues {
  defaultProtonPath?: string | null;
  autoRunGamemode?: boolean;
  autoRunMangohud?: boolean;
}

interface CompatibilityItem {
  focusId: string;
  render: (navigationOverrides: FocusOverrides) => React.JSX.Element;
  disabled?: boolean;
}

interface ProtonOption {
  focusId: string;
  value: string;
  title: string;
  description: string;
  disabled: boolean;
}

const DEFAULT_FORM: CompatibilityForm = {
  defaultProtonPath: "",
  autoRunGamemode: false,
  autoRunMangohud: false,
};

function getProtonSourceDescription(version: ProtonVersion | null) {
  if (!version) {
    return "Uses the default UMU-managed Proton version.";
  }

  if (
    version.source === "compatibility_tools" ||
    version.path.includes("compatibilitytools.d")
  ) {
    return "Installed in Steam compatibilitytools.d.";
  }

  return "Installed in Steam.";
}

export function CompatibilitySettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const userPreferences = useUserPreferences();
  const { showSuccessToast } = useBigPictureToast();
  const [form, setForm] = useState<CompatibilityForm>(DEFAULT_FORM);
  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [protonVersionsLoaded, setProtonVersionsLoaded] = useState(false);
  const [gamemodeAvailable, setGamemodeAvailable] = useState(false);
  const [mangohudAvailable, setMangohudAvailable] = useState(false);
  const [canInstallCommonRedist, setCanInstallCommonRedist] = useState(false);
  const [installingCommonRedist, setInstallingCommonRedist] = useState(false);

  const isDev = import.meta.env.DEV;
  const isLinux = globalThis.window.electron.platform === "linux";
  const isWindows = globalThis.window.electron.platform === "win32";
  const shouldRenderProtonSection = isLinux || isDev;
  const shouldRenderBehaviorSection = isLinux || isDev;
  const shouldRenderCommonRedistSection = isWindows || isDev;
  const canUseProtonSection = isLinux;
  const canUseBehaviorSection = isLinux;
  const canUseCommonRedistSection = isWindows;

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      defaultProtonPath: userPreferences.defaultProtonPath ?? "",
      autoRunGamemode: userPreferences.autoRunGamemode ?? false,
      autoRunMangohud: userPreferences.autoRunMangohud ?? false,
    });
  }, [userPreferences]);

  useEffect(() => {
    if (!isLinux) {
      setGamemodeAvailable(false);
      setMangohudAvailable(false);
      return;
    }

    globalThis.window.electron
      .isGamemodeAvailable()
      .then(setGamemodeAvailable)
      .catch(() => setGamemodeAvailable(false));

    globalThis.window.electron
      .isMangohudAvailable()
      .then(setMangohudAvailable)
      .catch(() => setMangohudAvailable(false));
  }, [isLinux]);

  useEffect(() => {
    if (!isLinux) return;

    globalThis.window.electron
      .getInstalledProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]))
      .finally(() => setProtonVersionsLoaded(true));
  }, [isLinux]);

  useEffect(() => {
    if (!isLinux) return;

    if (!protonVersionsLoaded || !form.defaultProtonPath) return;

    const hasSelectedVersion = protonVersions.some(
      (version) => version.path === form.defaultProtonPath
    );

    if (!hasSelectedVersion) {
      setForm((currentForm) => ({
        ...currentForm,
        defaultProtonPath: "",
      }));
    }
  }, [form.defaultProtonPath, isLinux, protonVersions, protonVersionsLoaded]);

  useEffect(() => {
    if (!isWindows) return;

    globalThis.window.electron.canInstallCommonRedist().then((canInstall) => {
      setCanInstallCommonRedist(canInstall);
    });

    const intervalId = globalThis.window.setInterval(() => {
      globalThis.window.electron
        .canInstallCommonRedist()
        .then((canInstall) => {
          setCanInstallCommonRedist(canInstall);
        })
        .catch(() => {
          setCanInstallCommonRedist(false);
        });
    }, 1000 * 5);

    return () => {
      globalThis.window.clearInterval(intervalId);
    };
  }, [isWindows]);

  useEffect(() => {
    if (!isWindows) return;

    return globalThis.window.electron.onCommonRedistProgress(
      ({ log, complete }) => {
        if (log === "Installation timed out" || complete) {
          setInstallingCommonRedist(false);

          if (complete) {
            showSuccessToast("Installation Complete", {
              message:
                "Common redistributables have been installed successfully.",
            });
          }
        }
      }
    );
  }, [isWindows, showSuccessToast]);

  const updateCompatibilityPreferences = useCallback(
    async (values: CompatibilityPreferenceValues) => {
      setForm((currentForm) => ({
        ...currentForm,
        ...values,
        defaultProtonPath:
          values.defaultProtonPath === undefined
            ? currentForm.defaultProtonPath
            : (values.defaultProtonPath ?? ""),
      }));

      await globalThis.window.electron.updateUserPreferences(values);
    },
    []
  );

  const handleInstallCommonRedist = useCallback(async () => {
    setInstallingCommonRedist(true);

    try {
      await globalThis.window.electron.installCommonRedist();
    } catch {
      setInstallingCommonRedist(false);
    }
  }, []);

  const handleOpenExternalLink = useCallback(
    async (event: ReactMouseEvent<HTMLAnchorElement>, url: string) => {
      event.preventDefault();
      event.stopPropagation();
      await globalThis.window.electron.openExternal(url);
    },
    []
  );

  const protonOptions = useMemo<ProtonOption[]>(() => {
    const options: ProtonOption[] = [
      {
        focusId: COMPATIBILITY_PROTON_OPTION_AUTO_FOCUS_ID,
        value: "",
        title: "Auto",
        description: getProtonSourceDescription(null),
        disabled: !canUseProtonSection,
      },
    ];

    for (const version of protonVersions) {
      options.push({
        focusId: getCompatibilityProtonOptionFocusId(version.path),
        value: version.path,
        title: version.name,
        description: getProtonSourceDescription(version),
        disabled: !canUseProtonSection,
      });
    }

    return options;
  }, [canUseProtonSection, protonVersions]);

  const items = useMemo<CompatibilityItem[]>(() => {
    const nextItems: CompatibilityItem[] = [];

    if (shouldRenderProtonSection) {
      nextItems.push(
        ...protonOptions.map((option) => ({
          focusId: option.focusId,
          disabled: option.disabled,
          render: (navigationOverrides: FocusOverrides) => (
            <Radio
              key={option.focusId}
              id={option.focusId}
              label={
                <span className="compatibility-settings-section__proton-option-label">
                  <span className="compatibility-settings-section__proton-option-title">
                    {option.title}
                  </span>
                  <span className="compatibility-settings-section__proton-option-description">
                    {option.description}
                  </span>
                </span>
              }
              checked={form.defaultProtonPath === option.value}
              disabled={option.disabled}
              focusId={option.focusId}
              navigationOverrides={navigationOverrides}
              block
              onChange={() => {
                void updateCompatibilityPreferences({
                  defaultProtonPath: option.value || null,
                });
              }}
            />
          ),
        }))
      );
    }

    if (shouldRenderBehaviorSection) {
      nextItems.push(
        {
          focusId: COMPATIBILITY_GAMEMODE_FOCUS_ID,
          disabled: !canUseBehaviorSection || !gamemodeAvailable,
          render: (navigationOverrides: FocusOverrides) => (
            <div
              key={COMPATIBILITY_GAMEMODE_FOCUS_ID}
              className="compatibility-settings-section__behavior-item"
            >
              <Checkbox
                id={COMPATIBILITY_GAMEMODE_FOCUS_ID}
                label="Run with GameMode"
                secondaryText={
                  <>
                    Improves performance on supported Linux systems.{" "}
                    <a
                      className="compatibility-settings-section__helper-link"
                      href={GAMEMODE_SITE_URL}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        void handleOpenExternalLink(event, GAMEMODE_SITE_URL);
                      }}
                    >
                      Learn more
                    </a>
                    .
                  </>
                }
                checked={form.autoRunGamemode}
                disabled={!canUseBehaviorSection || !gamemodeAvailable}
                focusId={COMPATIBILITY_GAMEMODE_FOCUS_ID}
                navigationOverrides={navigationOverrides}
                block
                onChange={(checked) => {
                  void updateCompatibilityPreferences({
                    autoRunGamemode: checked,
                  });
                }}
              />
              {canUseBehaviorSection && !gamemodeAvailable ? (
                <p className="compatibility-settings-section__helper-note">
                  GameMode is not available in your PATH.
                </p>
              ) : null}
            </div>
          ),
        },
        {
          focusId: COMPATIBILITY_MANGOHUD_FOCUS_ID,
          disabled: !canUseBehaviorSection || !mangohudAvailable,
          render: (navigationOverrides: FocusOverrides) => (
            <div
              key={COMPATIBILITY_MANGOHUD_FOCUS_ID}
              className="compatibility-settings-section__behavior-item"
            >
              <Checkbox
                id={COMPATIBILITY_MANGOHUD_FOCUS_ID}
                label="Run with MangoHud"
                secondaryText={
                  <>
                    Shows performance metrics while you play.{" "}
                    <a
                      className="compatibility-settings-section__helper-link"
                      href={MANGOHUD_SITE_URL}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        void handleOpenExternalLink(event, MANGOHUD_SITE_URL);
                      }}
                    >
                      Learn more
                    </a>
                    .
                  </>
                }
                checked={form.autoRunMangohud}
                disabled={!canUseBehaviorSection || !mangohudAvailable}
                focusId={COMPATIBILITY_MANGOHUD_FOCUS_ID}
                navigationOverrides={navigationOverrides}
                block
                onChange={(checked) => {
                  void updateCompatibilityPreferences({
                    autoRunMangohud: checked,
                  });
                }}
              />
              {canUseBehaviorSection && !mangohudAvailable ? (
                <p className="compatibility-settings-section__helper-note">
                  MangoHud is not available in your PATH.
                </p>
              ) : null}
            </div>
          ),
        }
      );
    }

    if (shouldRenderCommonRedistSection) {
      nextItems.push({
        focusId: COMPATIBILITY_COMMON_REDIST_BUTTON_ID,
        disabled: !canUseCommonRedistSection || !canInstallCommonRedist,
        render: (navigationOverrides: FocusOverrides) => (
          <Button
            key={COMPATIBILITY_COMMON_REDIST_BUTTON_ID}
            className="compatibility-settings-section__common-redist-button"
            disabled={!canUseCommonRedistSection || !canInstallCommonRedist}
            loading={installingCommonRedist}
            focusId={COMPATIBILITY_COMMON_REDIST_BUTTON_ID}
            focusNavigationOverrides={navigationOverrides}
            onClick={() => {
              void handleInstallCommonRedist();
            }}
          >
            {installingCommonRedist
              ? "Installing Common Redist..."
              : "Install Common Redist"}
          </Button>
        ),
      });
    }

    return nextItems;
  }, [
    canInstallCommonRedist,
    canUseBehaviorSection,
    canUseCommonRedistSection,
    form.autoRunGamemode,
    form.autoRunMangohud,
    form.defaultProtonPath,
    gamemodeAvailable,
    handleInstallCommonRedist,
    installingCommonRedist,
    mangohudAvailable,
    protonOptions,
    shouldRenderCommonRedistSection,
    shouldRenderBehaviorSection,
    shouldRenderProtonSection,
    updateCompatibilityPreferences,
  ]);

  const activeItems = useMemo(
    () => items.filter((item) => !item.disabled),
    [items]
  );

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      activeItems.map((item, index) => {
        const previousItem = activeItems[index - 1];
        const nextItem = activeItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : SETTINGS_HEADER_RETURN_TARGET,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : { type: "block" },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [activeItems]);

  return (
    <div
      className={
        className
          ? `compatibility-settings-section ${className}`
          : "compatibility-settings-section"
      }
    >
      {shouldRenderProtonSection ? (
        <SettingsSection
          title="Default Proton Version"
          description="Choose which Proton version Hydra should use by default for compatible games."
        >
          <VerticalFocusGroup
            regionId={COMPATIBILITY_SECTION_REGION_ID}
            asChild
          >
            <div className="compatibility-settings-section__proton-options">
              {protonOptions.map((option) =>
                items
                  .find((item) => item.focusId === option.focusId)
                  ?.render(navigationOverridesByFocusId[option.focusId] ?? {})
              )}
            </div>
          </VerticalFocusGroup>
        </SettingsSection>
      ) : null}

      {shouldRenderBehaviorSection ? (
        <SettingsSection
          title="Behavior"
          description="Control which compatibility helpers Hydra should use when launching supported games."
        >
          <div className="compatibility-settings-section__content">
            {items
              .filter(
                (item) =>
                  item.focusId === COMPATIBILITY_GAMEMODE_FOCUS_ID ||
                  item.focusId === COMPATIBILITY_MANGOHUD_FOCUS_ID
              )
              .map((item) =>
                item.render(navigationOverridesByFocusId[item.focusId] ?? {})
              )}
          </div>
        </SettingsSection>
      ) : null}

      {shouldRenderCommonRedistSection ? (
        <SettingsSection
          title="Common Redist"
          description="Install the Microsoft redistributables required by some Windows games."
        >
          <div className="compatibility-settings-section__content">
            {items
              .filter(
                (item) => item.focusId === COMPATIBILITY_COMMON_REDIST_BUTTON_ID
              )
              .map((item) =>
                item.render(navigationOverridesByFocusId[item.focusId] ?? {})
              )}
          </div>
        </SettingsSection>
      ) : null}
    </div>
  );
}
