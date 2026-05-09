import { useEffect, useState } from "react";
import { IS_DESKTOP } from "../../constants";
import type { DownloadSource, Game, GameRepack } from "@types";

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

      try {
        const sources = (await globalThis.window.electron.leveldb.values(
          "downloadSources"
        )) as DownloadSource[];
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
          setLocalDownloadSources(sources);
          setDownloadOptions(options);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLocalDownloadSources([]);
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
