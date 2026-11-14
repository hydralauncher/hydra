import type {
  RecompilationDetails,
  RecompilationReadme,
  RecompilationReleases,
  RecompilationSummary,
} from "@types";

const gamePath = (objectId: string) =>
  `/games/launchbox/${encodeURIComponent(objectId)}/recompilations`;

const portPath = (objectId: string, slug: string) =>
  `${gamePath(objectId)}/${encodeURIComponent(slug)}`;

export const getGameRecompilations = (objectId: string) =>
  window.electron.hydraApi.get<RecompilationSummary[]>(gamePath(objectId), {
    needsAuth: false,
  });

export const getRecompilation = (objectId: string, slug: string) =>
  window.electron.hydraApi.get<RecompilationDetails>(portPath(objectId, slug), {
    needsAuth: false,
  });

export const getRecompilationReadme = (
  objectId: string,
  slug: string,
  language: string
) =>
  window.electron.hydraApi.get<RecompilationReadme>(
    `${portPath(objectId, slug)}/readme`,
    { params: { language }, needsAuth: false }
  );

export const getRecompilationReleases = (objectId: string, slug: string) =>
  window.electron.hydraApi.get<RecompilationReleases>(
    `${portPath(objectId, slug)}/releases`,
    { needsAuth: false }
  );

export const buildRecompilationPath = (objectId: string, slug: string) =>
  `/recompilation/${encodeURIComponent(objectId)}/${encodeURIComponent(slug)}`;
