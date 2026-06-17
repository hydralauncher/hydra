import { useEffect, useState } from "react";
import { IS_DESKTOP } from "../../constants";
import type { DownloadSource, Game, GameRepack } from "@types";
import { orderBy } from "lodash-es";

export type DownloadOptionsEmptyStateReason =
  | "no-configured-sources"
  | "no-game-sources"
  | "no-download-options";

function getKnownGameSourcesEmptyStateReason(
  downloadSources: string[] | undefined
): DownloadOptionsEmptyStateReason | null {
  if (Array.isArray(downloadSources) && downloadSources.length === 0) {
    return "no-game-sources";
  }

  return null;
}

export function useGameDownloadOptions(
  game: Pick<Game, "objectId" | "shop"> & {
    downloadSources?: string[];
  },
  visible: boolean
) {
  const shouldLoadDownloadOptions =
    visible && IS_DESKTOP && game.shop !== "custom";
  const knownGameSourcesEmptyStateReason = getKnownGameSourcesEmptyStateReason(
    game.downloadSources
  );
  const downloadSourcesDependencyKey = Array.isArray(game.downloadSources)
    ? game.downloadSources.join("|")
    : "__unknown__";
  const [downloadOptions, setDownloadOptions] = useState<GameRepack[]>([]);
  const [localDownloadSources, setLocalDownloadSources] = useState<
    DownloadSource[]
  >([]);
  const [isCheckingSources, setIsCheckingSources] = useState(
    shouldLoadDownloadOptions && knownGameSourcesEmptyStateReason === null
  );
  const [isLoading, setIsLoading] = useState(
    shouldLoadDownloadOptions && knownGameSourcesEmptyStateReason === null
  );
  const [emptyStateReason, setEmptyStateReason] =
    useState<DownloadOptionsEmptyStateReason | null>(
      shouldLoadDownloadOptions ? knownGameSourcesEmptyStateReason : null
    );

  useEffect(() => {
    if (!shouldLoadDownloadOptions) {
      setDownloadOptions([]);
      setLocalDownloadSources([]);
      setIsCheckingSources(false);
      setIsLoading(false);
      setEmptyStateReason(null);
      return;
    }

    if (knownGameSourcesEmptyStateReason !== null) {
      setDownloadOptions([]);
      setLocalDownloadSources([]);
      setIsCheckingSources(false);
      setIsLoading(false);
      setEmptyStateReason(knownGameSourcesEmptyStateReason);
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

      if (
        knownGameSourcesEmptyStateReason !== null
      ) {
        if (!cancelled) {
          setDownloadOptions([]);
          setIsCheckingSources(false);
          setEmptyStateReason(knownGameSourcesEmptyStateReason);
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
    knownGameSourcesEmptyStateReason,
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
