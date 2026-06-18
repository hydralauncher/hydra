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

interface DownloadStateSetters {
  setDownloadOptions: (v: GameRepack[]) => void;
  setLocalDownloadSources: (v: DownloadSource[]) => void;
  setIsCheckingSources: (v: boolean) => void;
  setIsLoading: (v: boolean) => void;
  setEmptyStateReason: (v: DownloadOptionsEmptyStateReason | null) => void;
}

async function fetchDownloadOptions(
  game: Pick<Game, "objectId" | "shop">,
  signal: { cancelled: boolean },
  setters: DownloadStateSetters,
  knownGameSourcesEmptyStateReason: DownloadOptionsEmptyStateReason | null
) {
  const {
    setDownloadOptions,
    setLocalDownloadSources,
    setIsCheckingSources,
    setIsLoading,
    setEmptyStateReason,
  } = setters;

  if (!signal.cancelled) {
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

    if (!signal.cancelled) {
      setLocalDownloadSources(sortedSources);
    }
  } catch {
    if (!signal.cancelled) {
      setLocalDownloadSources([]);
      setIsCheckingSources(false);
      setDownloadOptions([]);
      setEmptyStateReason("no-configured-sources");
      setIsLoading(false);
    }

    return;
  }

  if (sortedSources.length === 0) {
    if (!signal.cancelled) {
      setDownloadOptions([]);
      setIsCheckingSources(false);
      setEmptyStateReason("no-configured-sources");
      setIsLoading(false);
    }

    return;
  }

  if (knownGameSourcesEmptyStateReason !== null) {
    if (!signal.cancelled) {
      setDownloadOptions([]);
      setIsCheckingSources(false);
      setEmptyStateReason(knownGameSourcesEmptyStateReason);
      setIsLoading(false);
    }

    return;
  }

  if (!signal.cancelled) {
    setIsCheckingSources(false);
    setIsLoading(true);
  }

  try {
    const endpoint = `/games/${game.shop}/${game.objectId}/download-sources`;

    const options = await globalThis.window.electron.hydraApi.get<GameRepack[]>(
      endpoint,
      {
        params: {
          take: 100,
          skip: 0,
          downloadSourceIds: sortedSources.map((source) => source.id),
        },
        needsAuth: false,
      }
    );

    if (!signal.cancelled) {
      setDownloadOptions(options);
      setEmptyStateReason(options.length === 0 ? "no-download-options" : null);
      setIsCheckingSources(false);
      setIsLoading(false);
    }
  } catch {
    if (!signal.cancelled) {
      setDownloadOptions([]);
      setEmptyStateReason("no-download-options");
      setIsCheckingSources(false);
      setIsLoading(false);
    }
  }
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

    const signal = { cancelled: false };

    void fetchDownloadOptions(
      game,
      signal,
      {
        setDownloadOptions,
        setLocalDownloadSources,
        setIsCheckingSources,
        setIsLoading,
        setEmptyStateReason,
      },
      knownGameSourcesEmptyStateReason
    );

    return () => {
      signal.cancelled = true;
    };
  }, [
    downloadSourcesDependencyKey,
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
