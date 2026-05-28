import "./integrations.scss";

import type {
  AllDebridUser,
  PremiumizeUser,
  RealDebridUser,
  TorBoxUser,
  UserPreferences,
} from "@types";
import { useMemo } from "react";

import { useFeature } from "../../hooks";
import type { FocusOverrideTarget } from "../../services";
import {
  getIntegrationProviderCheckboxFocusId,
  SETTINGS_HEADER_RETURN_TARGET,
  type IntegrationProviderId,
} from "./settings-navigation";
import {
  IntegrationProviderSection,
  type IntegrationProviderConfig,
} from "./integration-provider-section";

interface SettingsSectionProps {
  className?: string;
}

type DebridUser = RealDebridUser | PremiumizeUser | AllDebridUser | TorBoxUser;

type IntegrationPreferenceKey = Extract<
  keyof UserPreferences,
  | "realDebridApiToken"
  | "premiumizeApiToken"
  | "allDebridApiToken"
  | "torBoxApiToken"
>;

interface IntegrationProviderDefinition
  extends Omit<
    IntegrationProviderConfig<DebridUser>,
    "upTarget" | "downTarget"
  > {
  featureFlag?: string;
  tokenPreferenceKey: IntegrationPreferenceKey;
}

const REAL_DEBRID_API_TOKEN_URL = "https://real-debrid.com/apitoken";
const PREMIUMIZE_API_TOKEN_URL = "https://www.premiumize.me/account";
const ALL_DEBRID_API_TOKEN_URL = "https://alldebrid.com/apikeys/";
const TORBOX_API_TOKEN_URL = "https://torbox.app/settings";

const INTEGRATION_PROVIDERS: IntegrationProviderDefinition[] = [
  {
    id: "real-debrid",
    title: "Real-Debrid",
    description:
      "Real-Debrid is an unrestricted downloader that allows you to quickly download files, only limited by your internet speed.",
    checkboxLabel: "Enable Real-Debrid",
    tokenPreferenceKey: "realDebridApiToken",
    tokenUrl: REAL_DEBRID_API_TOKEN_URL,
    authenticate: (apiToken) =>
      globalThis.window.electron.authenticateRealDebrid(apiToken),
    getSuccessIdentity: (user) => {
      return (user as RealDebridUser).username ?? null;
    },
    getValidationErrorMessage: (user) => {
      if ((user as RealDebridUser).type === "free") {
        return `The account "${(user as RealDebridUser).username}" is a free account. Please subscribe to Real-Debrid.`;
      }

      return null;
    },
  },
  {
    id: "premiumize",
    title: "Premiumize",
    description:
      "Premiumize is an unrestricted downloader service that supports fast downloads and cloud transfers.",
    checkboxLabel: "Enable Premiumize",
    tokenPreferenceKey: "premiumizeApiToken",
    tokenUrl: PREMIUMIZE_API_TOKEN_URL,
    featureFlag: "PREMIUMIZE",
    authenticate: (apiToken) =>
      globalThis.window.electron.authenticatePremiumize(apiToken),
    getSuccessIdentity: (user) => {
      return (user as PremiumizeUser).customer_id ?? null;
    },
  },
  {
    id: "all-debrid",
    title: "AllDebrid",
    description:
      "AllDebrid is an unrestricted downloader service for premium links and magnet downloads.",
    checkboxLabel: "Enable AllDebrid",
    tokenPreferenceKey: "allDebridApiToken",
    tokenUrl: ALL_DEBRID_API_TOKEN_URL,
    featureFlag: "ALLDEBRID",
    authenticate: (apiToken) =>
      globalThis.window.electron.authenticateAllDebrid(apiToken),
    getSuccessIdentity: (user) => {
      return (user as AllDebridUser).username ?? null;
    },
  },
  {
    id: "torbox",
    title: "TorBox",
    description:
      "TorBox is your premium seedbox service rivaling even the best servers on the market.",
    checkboxLabel: "Enable TorBox",
    tokenPreferenceKey: "torBoxApiToken",
    tokenUrl: TORBOX_API_TOKEN_URL,
    featureFlag: "TORBOX",
    authenticate: (apiToken) =>
      globalThis.window.electron.authenticateTorBox(apiToken),
    getSuccessIdentity: (user) => {
      return (user as TorBoxUser).email ?? null;
    },
    getSuccessToastMessage: (user) => {
      return (user as TorBoxUser).email ?? null;
    },
  },
];

export function IntegrationsSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const { features } = useFeature();

  const visibleProviders = useMemo(() => {
    return INTEGRATION_PROVIDERS.filter((provider) => {
      if (!provider.featureFlag) return true;

      return features?.includes(provider.featureFlag) ?? false;
    });
  }, [features]);

  return (
    <div
      className={
        className
          ? `integrations-settings-section ${className}`
          : "integrations-settings-section"
      }
    >
      {visibleProviders.map((provider, index) => {
        const previousProvider = visibleProviders[index - 1];
        const nextProvider = visibleProviders[index + 1];

        const upTarget: FocusOverrideTarget = previousProvider
          ? {
              type: "item",
              itemId: getIntegrationProviderCheckboxFocusId(
                previousProvider.id as IntegrationProviderId
              ),
            }
          : SETTINGS_HEADER_RETURN_TARGET;

        const downTarget: FocusOverrideTarget = nextProvider
          ? {
              type: "item",
              itemId: getIntegrationProviderCheckboxFocusId(
                nextProvider.id as IntegrationProviderId
              ),
            }
          : {
              type: "block",
            };

        return (
          <IntegrationProviderSection
            key={provider.id}
            {...provider}
            upTarget={upTarget}
            downTarget={downTarget}
          />
        );
      })}
    </div>
  );
}
