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

function applyIfNotCancelled(
  signal: { cancelled: boolean },
  apply: () => void
) {
  if (!signal.cancelled) {
    apply();
  }
}

function resetDownloadOptionsState(
  signal: { cancelled: boolean },
  setters: DownloadStateSetters
) {
  applyIfNotCancelled(signal, () => {
    setters.setDownloadOptions([]);
    setters.setLocalDownloadSources([]);
    setters.setIsCheckingSources(true);
    setters.setIsLoading(false);
    setters.setEmptyStateReason(null);
  });
}

function setNoConfiguredSourcesState(
  signal: { cancelled: boolean },
  setters: DownloadStateSetters
) {
  applyIfNotCancelled(signal, () => {
    setters.setLocalDownloadSources([]);
    setters.setDownloadOptions([]);
    setters.setIsCheckingSources(false);
    setters.setIsLoading(false);
    setters.setEmptyStateReason("no-configured-sources");
  });
}

function setKnownEmptyState(
  signal: { cancelled: boolean },
  setters: DownloadStateSetters,
  reason: DownloadOptionsEmptyStateReason
) {
  applyIfNotCancelled(signal, () => {
    setters.setDownloadOptions([]);
    setters.setIsCheckingSources(false);
    setters.setIsLoading(false);
    setters.setEmptyStateReason(reason);
  });
}

function startRemoteDownloadOptionsLoading(
  signal: { cancelled: boolean },
  setters: DownloadStateSetters
) {
  applyIfNotCancelled(signal, () => {
    setters.setIsCheckingSources(false);
    setters.setIsLoading(true);
  });
}

function setDownloadOptionsSuccessState(
  signal: { cancelled: boolean },
  setters: DownloadStateSetters,
  options: GameRepack[]
) {
  applyIfNotCancelled(signal, () => {
    setters.setDownloadOptions(options);
    setters.setEmptyStateReason(
      options.length === 0 ? "no-download-options" : null
    );
    setters.setIsCheckingSources(false);
    setters.setIsLoading(false);
  });
}

function setNoDownloadOptionsState(
  signal: { cancelled: boolean },
  setters: DownloadStateSetters
) {
  applyIfNotCancelled(signal, () => {
    setters.setDownloadOptions([]);
    setters.setEmptyStateReason("no-download-options");
    setters.setIsCheckingSources(false);
    setters.setIsLoading(false);
  });
}

async function fetchDownloadOptions(
  game: Pick<Game, "objectId" | "shop">,
  signal: { cancelled: boolean },
  setters: DownloadStateSetters,
  knownGameSourcesEmptyStateReason: DownloadOptionsEmptyStateReason | null
) {
  resetDownloadOptionsState(signal, setters);

  let sortedSources: DownloadSource[] = [];

  try {
    const sources = (await globalThis.window.electron.leveldb.values(
      "downloadSources"
    )) as DownloadSource[];
    sortedSources = orderBy(sources, "createdAt", "desc");

    applyIfNotCancelled(signal, () => {
      setters.setLocalDownloadSources(sortedSources);
    });
  } catch {
    setNoConfiguredSourcesState(signal, setters);
    return;
  }

  if (sortedSources.length === 0) {
    setNoConfiguredSourcesState(signal, setters);
    return;
  }

  if (knownGameSourcesEmptyStateReason !== null) {
    setKnownEmptyState(signal, setters, knownGameSourcesEmptyStateReason);
    return;
  }

  startRemoteDownloadOptionsLoading(signal, setters);

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

    setDownloadOptionsSuccessState(signal, setters, options);
  } catch {
    setNoDownloadOptionsState(signal, setters);
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
