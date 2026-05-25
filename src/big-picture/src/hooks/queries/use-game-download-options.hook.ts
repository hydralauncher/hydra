import { useEffect, useState } from "react";
import { IS_DESKTOP } from "../../constants";
import type { DownloadSource, Game, GameRepack } from "@types";
import { orderBy } from "lodash-es";

export function useGameDownloadOptions(
  game: Pick<Game, "objectId" | "shop">,
  visible: boolean
) {
  const shouldLoadDownloadOptions =
    visible && IS_DESKTOP && game.shop !== "custom";
  const [downloadOptions, setDownloadOptions] = useState<GameRepack[]>([]);
  const [localDownloadSources, setLocalDownloadSources] = useState<
    DownloadSource[]
  >([]);
  const [isLoading, setIsLoading] = useState(shouldLoadDownloadOptions);

  useEffect(() => {
    if (!shouldLoadDownloadOptions) {
      setDownloadOptions([]);
      setLocalDownloadSources([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const fetchDownloadOptions = async () => {
      if (!cancelled) {
        setIsLoading(true);
      }

      let sources: DownloadSource[] = [];

      try {
        sources = (await globalThis.window.electron.leveldb.values(
          "downloadSources"
        )) as DownloadSource[];
        const sortedSources = orderBy(sources, "createdAt", "desc");

        if (!cancelled) {
          setLocalDownloadSources(sortedSources);
        }
      } catch {
        if (!cancelled) {
          setLocalDownloadSources([]);
        }
      }

      try {
        const endpoint = `/games/${game.shop}/${game.objectId}/download-sources`;

        const options = await globalThis.window.electron.hydraApi.get<
          GameRepack[]
        >(endpoint, {
          params: {
            take: 100,
            skip: 0,
            downloadSourceIds: sources.map((source) => source.id),
          },
          needsAuth: false,
        });

        if (!cancelled) {
          setDownloadOptions(options);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setDownloadOptions([]);
          setIsLoading(false);
        }
      }
    };

    void fetchDownloadOptions();

    return () => {
      cancelled = true;
    };
  }, [game.objectId, game.shop, shouldLoadDownloadOptions]);

  return { downloadOptions, localDownloadSources, isLoading };
}
