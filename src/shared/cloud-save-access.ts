export type CloudSaveAccessAction = "sign-in" | "paywall" | "open";

export const getCloudSaveAccessAction = (
  isAuthenticated: boolean,
  hasActiveSubscription: boolean
): CloudSaveAccessAction => {
  if (!isAuthenticated) return "sign-in";
  if (!hasActiveSubscription) return "paywall";
  return "open";
};
