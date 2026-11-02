import type { ProfileFriends, UserFriend } from "@types";

export const PROFILE_FRIENDS_PAGE_SIZE = 100;

export const fetchAllProfileFriends = async (
  fetchPage: (take: number, skip: number) => Promise<ProfileFriends>
): Promise<ProfileFriends> => {
  const firstPage = await fetchPage(PROFILE_FRIENDS_PAGE_SIZE, 0);
  const remainingSkips: number[] = [];

  for (
    let skip = PROFILE_FRIENDS_PAGE_SIZE;
    skip < firstPage.totalFriends;
    skip += PROFILE_FRIENDS_PAGE_SIZE
  ) {
    remainingSkips.push(skip);
  }

  const remainingPages = await Promise.all(
    remainingSkips.map((skip) => fetchPage(PROFILE_FRIENDS_PAGE_SIZE, skip))
  );

  const friendsById = new Map<string, UserFriend>();
  for (const page of [firstPage, ...remainingPages]) {
    for (const friend of page.friends) {
      if (!friendsById.has(friend.id)) friendsById.set(friend.id, friend);
    }
  }

  return {
    totalFriends: firstPage.totalFriends,
    onlineFriends: firstPage.onlineFriends,
    friends: [...friendsById.values()],
  };
};
