import "./account-privacy.scss";

import type {
  ProfileVisibility,
  Subscription,
  UserBlocks,
  UserFriend,
} from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  Checkbox,
  DropdownSelect,
  type DropdownSelectOption,
} from "../../components";
import {
  useBigPictureToast,
  useDate,
  useNavigation,
  useUserDetails,
} from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  ACCOUNT_PRIVACY_HYDRA_CLOUD_BUTTON_ID,
  ACCOUNT_PRIVACY_CLOUD_GIFTS_CHECKBOX_ID,
  ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
  ACCOUNT_PRIVACY_SOUVENIRS_SELECT_ID,
  getAccountPrivacyBlockedUserButtonFocusId,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface SettingsSectionProps {
  className?: string;
}

const SETTINGS_TOAST_OPTIONS = {
  fallbackVisual: "settings" as const,
};

function getProfileVisibilityLabel(
  value: ProfileVisibility,
  t: (key: string) => string
) {
  switch (value) {
    case "FRIENDS":
      return t("friends_only");
    case "PRIVATE":
      return t("private");
    default:
      return t("public");
  }
}

function getHydraCloudSectionContent(
  hasActiveSubscription: boolean,
  subscription: Subscription | null,
  formatDate: (date: string | Date | number) => string,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const hasSubscribedBefore = Boolean(subscription?.expiresAt);
  const isRenewalActive = subscription?.status === "active";

  if (!hasSubscribedBefore) {
    return {
      description: [t("no_subscription")],
      callToAction: t("become_subscriber"),
    };
  }

  if (hasActiveSubscription) {
    return {
      description: isRenewalActive
        ? [
            t("subscription_renews_on", {
              date: formatDate(subscription!.expiresAt!),
            }),
            t("bill_sent_until"),
          ]
        : [
            t("subscription_renew_cancelled"),
            t("subscription_active_until", {
              date: formatDate(subscription!.expiresAt!),
            }),
          ],
      callToAction: t("manage_subscription"),
    };
  }

  return {
    description: [
      t("subscription_expired_at", {
        date: formatDate(subscription!.expiresAt!),
      }),
    ],
    callToAction: t("renew_subscription"),
  };
}

export function AccountPrivacySettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const { formatDate } = useDate();
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const { setFocus } = useNavigation();
  const { userDetails, hasActiveSubscription, patchUser, unblockUser } =
    useUserDetails();
  const [profileVisibility, setProfileVisibility] =
    useState<ProfileVisibility>("PUBLIC");
  const [souvenirsVisibility, setSouvenirsVisibility] =
    useState<ProfileVisibility>("PRIVATE");
  const [blockedUsers, setBlockedUsers] = useState<UserFriend[]>([]);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const [isSavingCloudGifts, setIsSavingCloudGifts] = useState(false);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!userDetails?.profileVisibility) return;

    setProfileVisibility(userDetails.profileVisibility);
  }, [userDetails?.profileVisibility]);

  useEffect(() => {
    if (!userDetails?.souvenirsVisibility) return;

    setSouvenirsVisibility(userDetails.souvenirsVisibility);
  }, [userDetails?.souvenirsVisibility]);

  const fetchBlockedUsers = useCallback(async () => {
    if (!userDetails) {
      setBlockedUsers([]);
      return [];
    }

    const response = await globalThis.window.electron.hydraApi
      .get<UserBlocks>("/profile/blocks", {
        params: { take: 12, skip: 0 },
      })
      .catch(() => ({ totalBlocks: 0, blocks: [] }) satisfies UserBlocks);

    const nextBlockedUsers = response.blocks ?? [];
    setBlockedUsers(nextBlockedUsers);
    return nextBlockedUsers;
  }, [userDetails]);

  useEffect(() => {
    void fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const visibilityOptions = useMemo<
    Array<DropdownSelectOption<ProfileVisibility>>
  >(
    () => [
      { value: "PUBLIC", label: t("public") },
      { value: "FRIENDS", label: t("friends_only") },
      { value: "PRIVATE", label: t("private") },
    ],
    [t]
  );

  const hydraCloudContent = useMemo(() => {
    return getHydraCloudSectionContent(
      hasActiveSubscription,
      userDetails?.subscription ?? null,
      formatDate,
      t
    );
  }, [formatDate, hasActiveSubscription, t, userDetails?.subscription]);

  const blockedUserFocusIds = useMemo(
    () =>
      blockedUsers.map((user) => ({
        user,
        focusId: getAccountPrivacyBlockedUserButtonFocusId(user.id),
      })),
    [blockedUsers]
  );

  const handleProfileVisibilityChange = useCallback(
    async (value: ProfileVisibility) => {
      if (!userDetails || isSavingVisibility) return;

      const previousValue = profileVisibility;

      setProfileVisibility(value);
      setIsSavingVisibility(true);

      try {
        await patchUser({ profileVisibility: value });
        showSuccessToast("Profile visibility updated", {
          ...SETTINGS_TOAST_OPTIONS,
          message: `Your profile is now ${getProfileVisibilityLabel(value, t)}.`,
        });
      } catch {
        setProfileVisibility(previousValue);
        showErrorToast(
          "Failed to update profile visibility",
          SETTINGS_TOAST_OPTIONS
        );
      } finally {
        setIsSavingVisibility(false);
      }
    },
    [
      isSavingVisibility,
      patchUser,
      profileVisibility,
      showErrorToast,
      showSuccessToast,
      t,
      userDetails,
    ]
  );

  const handleSouvenirsVisibilityChange = useCallback(
    async (value: ProfileVisibility) => {
      if (!userDetails || isSavingVisibility) return;

      const previousValue = souvenirsVisibility;

      setSouvenirsVisibility(value);
      setIsSavingVisibility(true);

      try {
        await patchUser({ souvenirsVisibility: value });
        showSuccessToast(t("souvenirs_visibility_updated"), {
          ...SETTINGS_TOAST_OPTIONS,
          message: t("souvenirs_visibility_updated_description", {
            visibility: getProfileVisibilityLabel(value, t),
          }),
        });
      } catch {
        setSouvenirsVisibility(previousValue);
        showErrorToast(t("souvenir_visibility_failed"), SETTINGS_TOAST_OPTIONS);
      } finally {
        setIsSavingVisibility(false);
      }
    },
    [
      isSavingVisibility,
      patchUser,
      showErrorToast,
      showSuccessToast,
      souvenirsVisibility,
      t,
      userDetails,
    ]
  );

  const handleUnblock = useCallback(
    async (userId: string) => {
      const currentIndex = blockedUsers.findIndex((user) => user.id === userId);
      const nextUser = blockedUsers[currentIndex + 1];
      const previousUser = blockedUsers[currentIndex - 1];
      const nextFocusId = nextUser
        ? getAccountPrivacyBlockedUserButtonFocusId(nextUser.id)
        : previousUser
          ? getAccountPrivacyBlockedUserButtonFocusId(previousUser.id)
          : ACCOUNT_PRIVACY_HYDRA_CLOUD_BUTTON_ID;

      setUnblockingUserId(userId);

      try {
        await unblockUser(userId);
        await fetchBlockedUsers();
        globalThis.window.requestAnimationFrame(() => {
          setFocus(nextFocusId);
        });
      } finally {
        setUnblockingUserId(null);
      }
    },
    [blockedUsers, fetchBlockedUsers, setFocus, unblockUser]
  );

  const handleAllowCloudGiftsChange = useCallback(
    async (allowCloudGifts: boolean) => {
      if (!userDetails || isSavingCloudGifts) return;

      setIsSavingCloudGifts(true);

      try {
        await patchUser({ allowCloudGifts });
        showSuccessToast(t("changes_saved"), SETTINGS_TOAST_OPTIONS);
      } catch {
        showErrorToast(t("try_again"), SETTINGS_TOAST_OPTIONS);
      } finally {
        setIsSavingCloudGifts(false);
      }
    },
    [
      isSavingCloudGifts,
      patchUser,
      showErrorToast,
      showSuccessToast,
      t,
      userDetails,
    ]
  );

  const hydraCloudButtonOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: ACCOUNT_PRIVACY_CLOUD_GIFTS_CHECKBOX_ID,
      },
      down: blockedUserFocusIds[0]
        ? {
            type: "item",
            itemId: blockedUserFocusIds[0].focusId,
          }
        : { type: "block" },
    }),
    [blockedUserFocusIds]
  );

  const blockedUserNavigationOverrides = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      blockedUserFocusIds.map(({ focusId }, index) => {
        const previousItem = blockedUserFocusIds[index - 1];
        const nextItem = blockedUserFocusIds[index + 1];

        return [
          focusId,
          {
            up: previousItem
              ? { type: "item", itemId: previousItem.focusId }
              : {
                  type: "item",
                  itemId: ACCOUNT_PRIVACY_HYDRA_CLOUD_BUTTON_ID,
                },
            down: nextItem
              ? { type: "item", itemId: nextItem.focusId }
              : { type: "block" },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [blockedUserFocusIds]);

  if (!userDetails) return null;

  return (
    <div
      className={
        className
          ? `account-privacy-settings-section ${className}`
          : "account-privacy-settings-section"
      }
    >
      <SettingsSection
        title={t("privacy")}
        description={t("profile_visibility_description")}
      >
        <div className="account-privacy-settings-section__section-content">
          <DropdownSelect
            className="account-privacy-settings-section__select"
            label={t("profile_visibility")}
            value={profileVisibility}
            options={visibilityOptions}
            disabled={isSavingVisibility}
            focusId={ACCOUNT_PRIVACY_PRIVACY_SELECT_ID}
            focusNavigationOverrides={{
              up: SETTINGS_HEADER_RETURN_TARGET,
              down: {
                type: "item",
                itemId: ACCOUNT_PRIVACY_SOUVENIRS_SELECT_ID,
              },
            }}
            onValueChange={(value) => {
              void handleProfileVisibilityChange(value);
            }}
          />

          <DropdownSelect
            className="account-privacy-settings-section__select"
            label={t("souvenirs_visibility")}
            value={souvenirsVisibility}
            options={visibilityOptions}
            disabled={isSavingVisibility}
            focusId={ACCOUNT_PRIVACY_SOUVENIRS_SELECT_ID}
            focusNavigationOverrides={{
              up: {
                type: "item",
                itemId: ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
              },
              down: {
                type: "item",
                itemId: ACCOUNT_PRIVACY_CLOUD_GIFTS_CHECKBOX_ID,
              },
            }}
            onValueChange={(value) => {
              void handleSouvenirsVisibilityChange(value);
            }}
          />

          <Checkbox
            block
            checked={userDetails.allowCloudGifts}
            disabled={isSavingCloudGifts}
            focusId={ACCOUNT_PRIVACY_CLOUD_GIFTS_CHECKBOX_ID}
            navigationOverrides={{
              up: {
                type: "item",
                itemId: ACCOUNT_PRIVACY_SOUVENIRS_SELECT_ID,
              },
              down: {
                type: "item",
                itemId: ACCOUNT_PRIVACY_HYDRA_CLOUD_BUTTON_ID,
              },
            }}
            label={t("allow_cloud_gifts")}
            secondaryText={t("allow_cloud_gifts_description")}
            onChange={(checked) => {
              void handleAllowCloudGiftsChange(checked);
            }}
          />
        </div>
      </SettingsSection>

      {/* <SettingsSection
        title="Account"
        description="Review your current account details and update your security settings."
      >
        <div className="account-privacy-settings-section__section-content account-privacy-settings-section__section-content--account">
          <div className="account-privacy-settings-section__detail-grid">
            <Input
              className="account-privacy-settings-section__readonly-field"
              label="Username"
              value={userDetails.username}
              readOnly
              focusNavigationState="disabled"
            />

            <Input
              className="account-privacy-settings-section__readonly-field"
              label="Current Email"
              value={userDetails.email ?? "You have not set an email yet"}
              readOnly
              focusNavigationState="disabled"
            />
          </div>

          <HorizontalFocusGroup
            className="account-privacy-settings-section__actions"
            asChild
          >
            <div className="account-privacy-settings-section__actions">
              <Button
                className="account-privacy-settings-section__action-button"
                variant="secondary"
                focusId={ACCOUNT_PRIVACY_UPDATE_EMAIL_BUTTON_ID}
                focusNavigationOverrides={updateEmailButtonOverrides}
                onClick={() => {
                  void globalThis.window.electron.openAuthWindow(
                    AuthPage.UpdateEmail
                  );
                }}
              >
                Update Email
              </Button>

              <Button
                className="account-privacy-settings-section__action-button"
                variant="secondary"
                focusId={ACCOUNT_PRIVACY_UPDATE_PASSWORD_BUTTON_ID}
                focusNavigationOverrides={updatePasswordButtonOverrides}
                onClick={() => {
                  void globalThis.window.electron.openAuthWindow(
                    AuthPage.UpdatePassword
                  );
                }}
              >
                Update Password
              </Button>
            </div>
          </HorizontalFocusGroup>
        </div>
      </SettingsSection> */}

      <SettingsSection
        title="Hydra Cloud"
        description="Check your subscription status and manage your Hydra Cloud plan."
      >
        <div className="account-privacy-settings-section__section-content">
          <div className="account-privacy-settings-section__subscription-copy">
            {hydraCloudContent.description.map((line) => (
              <p
                key={line}
                className="account-privacy-settings-section__subscription-line"
              >
                {line}
              </p>
            ))}
          </div>

          <Button
            className="account-privacy-settings-section__cloud-button"
            focusId={ACCOUNT_PRIVACY_HYDRA_CLOUD_BUTTON_ID}
            focusNavigationOverrides={hydraCloudButtonOverrides}
            onClick={() => {
              void globalThis.window.electron.openCheckout();
            }}
          >
            {hydraCloudContent.callToAction}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Blocked Users"
        description="Review the users you have blocked and unblock them anytime."
      >
        <div className="account-privacy-settings-section__section-content">
          {blockedUserFocusIds.length > 0 ? (
            <div className="account-privacy-settings-section__blocked-users">
              {blockedUserFocusIds.map(({ user, focusId }) => (
                <div
                  key={user.id}
                  className="account-privacy-settings-section__blocked-user"
                >
                  <div className="account-privacy-settings-section__blocked-user-info">
                    {user.profileImageUrl ? (
                      <img
                        src={user.profileImageUrl}
                        alt={user.displayName}
                        className="account-privacy-settings-section__blocked-user-avatar"
                        width={40}
                        height={40}
                        draggable={false}
                      />
                    ) : (
                      <div className="account-privacy-settings-section__blocked-user-avatar account-privacy-settings-section__blocked-user-avatar--placeholder">
                        {user.displayName[0]?.toUpperCase() ?? "?"}
                      </div>
                    )}

                    <p className="account-privacy-settings-section__blocked-user-name">
                      {user.displayName}
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    loading={unblockingUserId === user.id}
                    focusId={focusId}
                    focusNavigationOverrides={
                      blockedUserNavigationOverrides[focusId]
                    }
                    onClick={() => {
                      void handleUnblock(user.id);
                    }}
                  >
                    Unblock
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="account-privacy-settings-section__empty">
              You have no blocked users.
            </p>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
