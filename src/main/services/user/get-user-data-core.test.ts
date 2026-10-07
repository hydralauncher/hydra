import assert from "node:assert/strict";
import test from "node:test";
import type { User, UserDetails } from "@types";
import type { HydraApiAuthContext } from "../hydra-auth-context";
import {
  getUserDataForContext,
  type GetUserDataDependencies,
} from "./get-user-data-core.ts";

const contextA: HydraApiAuthContext = {
  environment: "http://localhost:3000",
  userId: "HydraA",
  generation: 1,
};
const contextB = { ...contextA, userId: "HydraB", generation: 2 };
const subscription: UserDetails["subscription"] = {
  id: "subscriptionA",
  status: "active",
  plan: { id: "planA", name: "Hydra Cloud" },
  expiresAt: "2026-11-07T15:00:00.000Z",
  paymentMethod: "pix",
};
const profile: UserDetails = {
  id: "HydraA",
  username: "playerA",
  email: "player@example.com",
  displayName: "Player A",
  profileImageUrl: "https://example.com/avatar-a",
  backgroundImageUrl: null,
  profileVisibility: "PRIVATE",
  allowCloudGifts: false,
  souvenirsVisibility: "PRIVATE",
  bio: "Profile A",
  workwondersJwt: "private-workwonders-token",
  subscription,
  karma: 1,
};
const cachedA: User = {
  id: "HydraA",
  displayName: "Cached A",
  profileImageUrl: null,
  backgroundImageUrl: null,
  subscription,
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

const fixture = () => {
  let current: HydraApiAuthContext | null = contextA;
  let cached: User = { ...cachedA };
  const writes: User[] = [];
  const subscriptions: UserDetails["subscription"][] = [];
  const errors: string[] = [];
  let fetches = 0;
  const dependencies: GetUserDataDependencies = {
    context: contextA,
    isCurrent: (context) =>
      current?.generation === context.generation &&
      current.userId === context.userId &&
      current.environment === context.environment,
    getProfile: async (context) => {
      fetches++;
      assert.deepEqual(context, contextA);
      return { ...profile };
    },
    getCachedUser: async () => cached,
    putCachedUser: async (value) => {
      cached = value;
      writes.push(value);
    },
    updateSubscription: (value) => subscriptions.push(value),
    isAuthRequiredError: (error) =>
      error instanceof Error && error.name === "UserNotLoggedInError",
    reportError: (operation) => errors.push(operation),
  };
  return {
    dependencies,
    writes,
    subscriptions,
    errors,
    fetches: () => fetches,
    cached: () => cached,
    switchTo: (context: HydraApiAuthContext | null) => {
      current = context;
      if (context?.userId === contextB.userId) {
        cached = {
          ...cachedA,
          id: contextB.userId,
          displayName: "Cached B",
          subscription: null,
        };
      }
    },
  };
};

test("current profile refresh preserves cache update and subscription behavior", async () => {
  const f = fixture();
  assert.deepEqual(await getUserDataForContext(f.dependencies), profile);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.cached(), {
    id: profile.id,
    displayName: profile.displayName,
    profileImageUrl: profile.profileImageUrl,
    backgroundImageUrl: profile.backgroundImageUrl,
    subscription: profile.subscription,
  });
  assert.deepEqual(f.subscriptions, [subscription]);
  assert.deepEqual(f.errors, []);
});

test("delayed A cache read cannot write profile or subscription after B signs in", async () => {
  const f = fixture();
  const reading = deferred<void>();
  const cacheRead = deferred<User>();
  const request = getUserDataForContext({
    ...f.dependencies,
    getCachedUser: () => {
      reading.resolve();
      return cacheRead.promise;
    },
  });
  await reading.promise;
  f.switchTo(contextB);
  const userBBefore = f.cached();
  cacheRead.resolve(cachedA);
  assert.equal(await request, null);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.subscriptions, []);
  assert.deepEqual(f.cached(), userBBefore);
});

test("logout during profile request discards its response before reading cache", async () => {
  const f = fixture();
  const response = deferred<UserDetails>();
  let cacheReads = 0;
  const request = getUserDataForContext({
    ...f.dependencies,
    getProfile: () => response.promise,
    getCachedUser: async () => {
      cacheReads++;
      return cachedA;
    },
  });
  f.switchTo(null);
  response.resolve(profile);
  assert.equal(await request, null);
  assert.equal(cacheReads, 0);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.subscriptions, []);
});

test("profile belonging to another Hydra account cannot replace current user", async () => {
  const f = fixture();
  const result = await getUserDataForContext({
    ...f.dependencies,
    getProfile: async () => ({ ...profile, id: contextB.userId }),
  });
  assert.equal(result, null);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.subscriptions, []);
});

test("offline profile returns matching cached owner without secrets in error callbacks", async () => {
  const f = fixture();
  const result = await getUserDataForContext({
    ...f.dependencies,
    getProfile: async () => {
      throw new Error("private-access-token from Axios config");
    },
  });
  assert.equal(result?.id, contextA.userId);
  assert.equal(result?.displayName, cachedA.displayName);
  assert.equal(result?.username, "");
  assert.equal(result?.email, null);
  assert.equal(result?.profileVisibility, "PUBLIC");
  assert.equal(result?.souvenirsVisibility, "PRIVATE");
  assert.deepEqual(f.errors, ["profile"]);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.subscriptions, []);
});

test("offline fallback never returns A cache to a current B request", async () => {
  const f = fixture();
  f.switchTo(contextB);
  const result = await getUserDataForContext({
    ...f.dependencies,
    context: contextB,
    getProfile: async () => {
      throw new Error("offline");
    },
    getCachedUser: async () => cachedA,
  });
  assert.equal(result, null);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.subscriptions, []);
});

test("switching accounts while offline cache loads discards stale fallback", async () => {
  const f = fixture();
  const reading = deferred<void>();
  const cacheRead = deferred<User>();
  const request = getUserDataForContext({
    ...f.dependencies,
    getProfile: async () => {
      throw new Error("offline");
    },
    getCachedUser: () => {
      reading.resolve();
      return cacheRead.promise;
    },
  });
  await reading.promise;
  f.switchTo(contextB);
  cacheRead.resolve(cachedA);
  assert.equal(await request, null);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.subscriptions, []);
});

test("same-account relogin uses a new generation and rejects old profile", async () => {
  const f = fixture();
  const response = deferred<UserDetails>();
  const request = getUserDataForContext({
    ...f.dependencies,
    getProfile: () => response.promise,
  });
  f.switchTo({ ...contextA, generation: 3 });
  response.resolve(profile);
  assert.equal(await request, null);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.subscriptions, []);
});

test("missing cache preserves successful online profile without creating a new cache path", async () => {
  const f = fixture();
  const result = await getUserDataForContext({
    ...f.dependencies,
    getCachedUser: async () => {
      throw Object.assign(new Error("NotFound"), { code: "LEVEL_NOT_FOUND" });
    },
  });
  assert.deepEqual(result, profile);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.subscriptions, [subscription]);
  assert.deepEqual(f.errors, ["cache-write"]);
});

test("logout during a started cache write never applies stale subscription", async () => {
  const f = fixture();
  const writing = deferred<void>();
  const cacheWrite = deferred<void>();
  const request = getUserDataForContext({
    ...f.dependencies,
    putCachedUser: () => {
      writing.resolve();
      return cacheWrite.promise;
    },
  });
  await writing.promise;
  f.switchTo(contextB);
  cacheWrite.resolve();
  assert.equal(await request, null);
  assert.deepEqual(f.subscriptions, []);
});

test("missing auth and auth-required errors do not use cached fallback", async () => {
  const f = fixture();
  assert.equal(
    await getUserDataForContext({ ...f.dependencies, context: null }),
    null
  );
  assert.equal(f.fetches(), 0);
  const result = await getUserDataForContext({
    ...f.dependencies,
    getProfile: async () => {
      throw Object.assign(new Error("logged out"), {
        name: "UserNotLoggedInError",
      });
    },
  });
  assert.equal(result, null);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.subscriptions, []);
});
