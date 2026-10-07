import type { User, UserDetails } from "@types";
import type { HydraApiAuthContext } from "../hydra-auth-context";

export interface GetUserDataDependencies {
  context: HydraApiAuthContext | null;
  isCurrent(context: HydraApiAuthContext): boolean;
  getProfile(context: HydraApiAuthContext): Promise<UserDetails>;
  getCachedUser(): Promise<User>;
  putCachedUser(user: User): Promise<void>;
  updateSubscription(subscription: UserDetails["subscription"]): void;
  isAuthRequiredError(error: unknown): boolean;
  reportError(operation: "profile" | "cache-read" | "cache-write"): void;
}

const cachedUserDetails = (user: User): UserDetails =>
  ({
    ...user,
    username: "",
    bio: "",
    email: null,
    profileVisibility: "PUBLIC",
    souvenirsVisibility: "PRIVATE",
    quirks: { backupsPerGameLimit: 0 },
    subscription: user.subscription
      ? {
          id: user.subscription.id,
          status: user.subscription.status,
          plan: {
            id: user.subscription.plan.id,
            name: user.subscription.plan.name,
          },
          expiresAt: user.subscription.expiresAt,
        }
      : null,
  }) as UserDetails;

export async function getUserDataForContext(
  dependencies: GetUserDataDependencies
): Promise<UserDetails | null> {
  const context = dependencies.context;
  if (!context || !dependencies.isCurrent(context)) return null;

  let me: UserDetails;
  try {
    me = await dependencies.getProfile(context);
  } catch (error) {
    if (
      !dependencies.isCurrent(context) ||
      dependencies.isAuthRequiredError(error)
    ) {
      return null;
    }
    dependencies.reportError("profile");
    try {
      const cached = await dependencies.getCachedUser();
      if (
        !dependencies.isCurrent(context) ||
        !cached ||
        cached.id !== context.userId
      ) {
        return null;
      }
      return cachedUserDetails(cached);
    } catch {
      if (dependencies.isCurrent(context)) {
        dependencies.reportError("cache-read");
      }
      return null;
    }
  }

  if (!dependencies.isCurrent(context) || me.id !== context.userId) return null;

  try {
    const cached = await dependencies.getCachedUser();
    if (!dependencies.isCurrent(context)) return null;
    await dependencies.putCachedUser({
      ...cached,
      id: me.id,
      displayName: me.displayName,
      profileImageUrl: me.profileImageUrl,
      backgroundImageUrl: me.backgroundImageUrl,
      subscription: me.subscription,
    });
  } catch {
    if (!dependencies.isCurrent(context)) return null;
    dependencies.reportError("cache-write");
  }

  if (!dependencies.isCurrent(context)) return null;
  dependencies.updateSubscription(me.subscription);
  return me;
}
