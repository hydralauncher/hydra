import { useEffect, useState } from "react";
import { IS_DESKTOP } from "../../constants";
import type { DownloadSource, Game, GameRepack } from "@types";
import { orderBy } from "lodash-es";

export type DownloadOptionsEmptyStateReason =
  | "no-configured-sources"
  | "no-game-sources"
  | "no-download-options";

export function useGameDownloadOptions(
  game: Pick<Game, "objectId" | "shop"> & {
    downloadSources?: string[];
  },
  visible: boolean
) {
  const shouldLoadDownloadOptions =
    visible && IS_DESKTOP && game.shop !== "custom";
  const downloadSourcesDependencyKey = Array.isArray(game.downloadSources)
    ? game.downloadSources.join("|")
    : "__unknown__";
  const [downloadOptions, setDownloadOptions] = useState<GameRepack[]>([]);
  const [localDownloadSources, setLocalDownloadSources] = useState<
    DownloadSource[]
  >([]);
  const [isCheckingSources, setIsCheckingSources] =
    useState(shouldLoadDownloadOptions);
  const [isLoading, setIsLoading] = useState(shouldLoadDownloadOptions);
  const [emptyStateReason, setEmptyStateReason] =
    useState<DownloadOptionsEmptyStateReason | null>(null);

  useEffect(() => {
    if (!shouldLoadDownloadOptions) {
      setDownloadOptions([]);
      setLocalDownloadSources([]);
      setIsCheckingSources(false);
      setIsLoading(false);
      setEmptyStateReason(null);
      return;
    }

    let cancelled = false;

    const fetchDownloadOptions = async () => {
      if (!cancelled) {
        setDownloadOptions([]);
        setLocalDownloadSources([]);
        setIsCheckingSources(true);
        setIsLoading(false);
        setEmptyStateReason(null);
      }

      let sortedSources: DownloadSource[] = [];

      try {
        const sources = (await globalThis.window.electron.leveldb.values(
          "downloadSources"
        )) as DownloadSource[];
        sortedSources = orderBy(sources, "createdAt", "desc");

        if (!cancelled) {
          setLocalDownloadSources(sortedSources);
        }
      } catch {
        if (!cancelled) {
          setLocalDownloadSources([]);
          setIsCheckingSources(false);
          setDownloadOptions([]);
          setEmptyStateReason("no-configured-sources");
          setIsLoading(false);
        }

        return;
      }

      if (sortedSources.length === 0) {
        if (!cancelled) {
          setDownloadOptions([]);
          setIsCheckingSources(false);
          setEmptyStateReason("no-configured-sources");
          setIsLoading(false);
        }

        return;
      }

      if (Array.isArray(game.downloadSources) && game.downloadSources.length === 0) {
        if (!cancelled) {
          setDownloadOptions([]);
          setIsCheckingSources(false);
          setEmptyStateReason("no-game-sources");
          setIsLoading(false);
        }

        return;
      }

      if (!cancelled) {
        setIsCheckingSources(false);
        setIsLoading(true);
      }

      try {
        const endpoint = `/games/${game.shop}/${game.objectId}/download-sources`;

        const options = await globalThis.window.electron.hydraApi.get<
          GameRepack[]
        >(endpoint, {
          params: {
            take: 100,
            skip: 0,
            downloadSourceIds: sortedSources.map((source) => source.id),
          },
          needsAuth: false,
        });

        if (!cancelled) {
          setDownloadOptions(options);
          setEmptyStateReason(
            options.length === 0 ? "no-download-options" : null
          );
          setIsCheckingSources(false);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setDownloadOptions([]);
          setEmptyStateReason("no-download-options");
          setIsCheckingSources(false);
          setIsLoading(false);
        }
      }
    };

    void fetchDownloadOptions();

    return () => {
      cancelled = true;
    };
  }, [
    downloadSourcesDependencyKey,
    game.downloadSources,
    game.objectId,
    game.shop,
    shouldLoadDownloadOptions,
  ]);

  return {
    downloadOptions,
    localDownloadSources,
    isCheckingSources,
    isLoading,
    emptyStateReason,
  };
}
