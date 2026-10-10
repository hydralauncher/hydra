import { PROFILE_FRIENDS_PATH } from "@shared";
import type { FriendRequest, FriendsSnapshot, ProfileFriends } from "@types";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";

// Same page size the friends window fetches.
const FRIENDS_PAGE_SIZE = 100;
// Reopening the profile menu within this window reuses the last snapshot
// instead of hitting the API again.
const SNAPSHOT_MAX_AGE_MS = 15_000;

export class FriendsSnapshotCache {
  private static snapshot: FriendsSnapshot | null = null;
  private static fetchedAt = 0;
  private static inFlight: Promise<FriendsSnapshot | null> | null = null;
  // Bumped on clear() so a request started before sign-out can't repopulate
  // the cache with the previous user's friends.
  private static generation = 0;

  public static prefetch(): Promise<FriendsSnapshot | null> {
    if (!HydraApi.isLoggedIn()) return Promise.resolve(null);
    if (this.inFlight !== null) return this.inFlight;

    if (this.snapshot && Date.now() - this.fetchedAt < SNAPSHOT_MAX_AGE_MS) {
      return Promise.resolve(this.snapshot);
    }

    const request = this.fetchSnapshot(this.generation);
    this.inFlight = request;

    void request.finally(() => {
      if (this.inFlight === request) this.inFlight = null;
    });

    return request;
  }

  // Waits for a prefetch that is still running; otherwise returns whatever is
  // cached. The friends window revalidates right after painting it.
  public static get(): Promise<FriendsSnapshot | null> {
    return this.inFlight ?? Promise.resolve(this.snapshot);
  }

  public static clear() {
    this.snapshot = null;
    this.fetchedAt = 0;
    this.inFlight = null;
    this.generation++;
  }

  private static async fetchSnapshot(
    generation: number
  ): Promise<FriendsSnapshot | null> {
    try {
      const [profileFriends, friendRequests] = await Promise.all([
        HydraApi.get<ProfileFriends>(PROFILE_FRIENDS_PATH, {
          take: FRIENDS_PAGE_SIZE,
          skip: 0,
        }),
        HydraApi.get<FriendRequest[]>("/profile/friend-requests"),
      ]);

      if (generation !== this.generation) return null;

      this.snapshot = {
        friends: profileFriends.friends,
        onlineFriends: profileFriends.onlineFriends,
        friendRequests,
      };
      this.fetchedAt = Date.now();

      return this.snapshot;
    } catch (error) {
      logger.error("Failed to prefetch friends", error);
      return null;
    }
  }
}
