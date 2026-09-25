import type { UserDetails } from "@types";

export const syncSubscriptionState = async (
  signal: AbortSignal,
  dependencies: {
    fetch: (signal: AbortSignal) => Promise<UserDetails | null>;
    isLoggedIn: () => boolean;
    broadcast: (userDetails: UserDetails) => void;
  }
) => {
  const userDetails = await dependencies.fetch(signal);
  if (signal.aborted || !dependencies.isLoggedIn() || !userDetails) return;
  dependencies.broadcast(userDetails);
};
