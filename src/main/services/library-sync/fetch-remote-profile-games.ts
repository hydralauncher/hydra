const PAGE_SIZE = 100;
const PAGE_FETCH_CONCURRENCY = 3;

type FetchProfileGames<T> = (
  path: string,
  params: Record<string, unknown>
) => Promise<T[]>;

export const fetchRemoteProfileGames = async <T>(
  fetchGames: FetchProfileGames<T>
): Promise<T[]> => {
  const fetchAllGamesForShop = async (
    params: Record<string, unknown> = {},
    path = "/profile/games"
  ): Promise<T[]> => {
    const fetchPage = (pageIndex: number) =>
      fetchGames(path, {
        ...params,
        take: PAGE_SIZE,
        skip: pageIndex * PAGE_SIZE,
      });

    const firstPage = await fetchPage(0);
    if (firstPage.length < PAGE_SIZE) return firstPage;

    const all = [...firstPage];

    for (let nextPageIndex = 1; ; nextPageIndex += PAGE_FETCH_CONCURRENCY) {
      const pages = await Promise.all(
        Array.from({ length: PAGE_FETCH_CONCURRENCY }, (_, offset) =>
          fetchPage(nextPageIndex + offset)
        )
      );

      for (const page of pages) all.push(...page);

      if (pages.some((page) => page.length < PAGE_SIZE)) break;
    }

    return all;
  };

  const fetchAllHiddenGamesForShop = (params: Record<string, unknown> = {}) =>
    fetchAllGamesForShop(params, "/profile/games/hidden").catch((error) => {
      if (error?.response?.status === 404) return [] as T[];
      throw error;
    });

  const [defaultGames, classicsGames, hiddenGames, hiddenClassicsGames] =
    await Promise.all([
      fetchAllGamesForShop(),
      fetchAllGamesForShop({ shop: "launchbox" }).catch(() => [] as T[]),
      fetchAllHiddenGamesForShop(),
      fetchAllHiddenGamesForShop({ shop: "launchbox" }),
    ]);

  return [
    ...defaultGames,
    ...classicsGames,
    ...hiddenGames,
    ...hiddenClassicsGames,
  ];
};
