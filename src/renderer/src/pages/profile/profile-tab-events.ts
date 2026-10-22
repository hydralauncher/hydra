import type { ProfileTabType } from "./profile-content/profile-tabs";

export const OPEN_PROFILE_TAB_EVENT = "hydra:open-profile-tab";

export const openProfileTab = (tab: ProfileTabType) => {
  window.dispatchEvent(
    new CustomEvent<ProfileTabType>(OPEN_PROFILE_TAB_EVENT, { detail: tab })
  );
};
