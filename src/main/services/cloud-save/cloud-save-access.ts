import {
  getCloudSaveAccessAction,
  SubscriptionRequiredError,
  UserNotLoggedInError,
} from "@shared";

import { HydraApi } from "../hydra-api";

export const canAccessCloudSaves = (
  isLoggedIn: boolean,
  hasActiveSubscription: boolean
) => getCloudSaveAccessAction(isLoggedIn, hasActiveSubscription) === "open";

export const assertCloudSaveSubscription = (
  isLoggedIn = HydraApi.isLoggedIn(),
  hasActiveSubscription = HydraApi.hasActiveSubscription()
) => {
  if (!isLoggedIn) {
    throw new UserNotLoggedInError();
  }
  if (!hasActiveSubscription) {
    throw new SubscriptionRequiredError();
  }
};
