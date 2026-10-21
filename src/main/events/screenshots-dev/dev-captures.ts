import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { resolveScreenshotPreferences } from "@shared";
import type {
  GameShop,
  ScreenshotsDevCaptureRequest,
  ScreenshotsDevGame,
  ScreenshotsDevImageSource,
  UserPreferences,
} from "@types";

import { emulatorSessions } from "@main/services/emulators/emulator-session-tracker";
import { gamesPlaytime } from "@main/services/game-running-state";
import { SystemPath } from "@main/services/system-path";
import {
  finishCapture,
  rejectAdultGameCapture,
  resolveCaptureFilePath,
} from "@main/services/screenshots/screenshot-capture-service";
import { onScreenshotGameClosed } from "@main/services/screenshots";

const DEV_CAPTURE_JPEG_QUALITY = 100;

const simulatedRunningGameKeys = new Set<string>();

const getGameKey = (shop: GameShop, objectId: string) =>
  levelKeys.game(shop, objectId);

const isGameRunning = (gameKey: string) =>
  simulatedRunningGameKeys.has(gameKey) ||
  gamesPlaytime.has(gameKey) ||
  emulatorSessions.has(gameKey);

const escapeXml = (value: string) =>
  value.replaceAll(/[<>&'"]/g, (character) => `&#${character.charCodeAt(0)};`);

const buildPatternSvg = (width: number, height: number, label: string) => {
  const columns = 16;
  const rows = 9;
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const hue = Math.round((index * 360) / (columns * rows));
    return `<rect x="${column * cellWidth}" y="${row * cellHeight}" width="${cellWidth}" height="${cellHeight}" fill="hsl(${hue},55%,${row % 2 === 0 ? 38 : 30}%)"/>`;
  }).join("");
  const fontSize = Math.round(height / 18);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${cells}<rect x="${width * 0.1}" y="${height * 0.38}" width="${width * 0.8}" height="${height * 0.24}" rx="${fontSize / 2}" fill="rgba(0,0,0,0.6)"/><text x="50%" y="47%" font-family="sans-serif" font-size="${fontSize}" fill="#ffffff" text-anchor="middle">${escapeXml(label)}</text><text x="50%" y="56%" font-family="sans-serif" font-size="${Math.round(fontSize * 0.6)}" fill="#dddddd" text-anchor="middle">${width}x${height} ${escapeXml(new Date().toLocaleString())}</text></svg>`;
};

const renderImage = async (
  source: ScreenshotsDevImageSource,
  label: string
) => {
  const input =
    source.kind === "pattern"
      ? Buffer.from(buildPatternSvg(source.width, source.height, label))
      : await fs.promises.readFile(source.path);

  const { data, info } = await sharp(input)
    .rotate()
    .jpeg({ quality: DEV_CAPTURE_JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
};

const readPreferences = async () =>
  resolveScreenshotPreferences(
    await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null)
  );

export const listDevGames = async (): Promise<ScreenshotsDevGame[]> => {
  const games = await gamesSublevel.values().all();
  return games
    .filter((game) => !game.isDeleted)
    .map((game) => ({
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
      isRunning: isGameRunning(getGameKey(game.shop, game.objectId)),
    }))
    .toSorted((a, b) => a.title.localeCompare(b.title));
};

export const simulateCapture = async ({
  game,
  image,
  signedOut,
  adult,
}: ScreenshotsDevCaptureRequest) => {
  if (adult) {
    await rejectAdultGameCapture(game.title);
    return null;
  }

  const gameKey = getGameKey(game.shop, game.objectId);
  simulatedRunningGameKeys.add(gameKey);

  const preferences = await readPreferences();
  const capturedAt = new Date();
  const rendered = await renderImage(image, game.title);
  const filePath = await resolveCaptureFilePath(game.title, capturedAt);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, rendered.data);

  return finishCapture({
    target: { gameKey, shop: game.shop, objectId: game.objectId },
    gameTitle: game.title,
    filePath,
    capturedAt,
    size: { width: rendered.width, height: rendered.height },
    defaultVisibility: preferences.defaultVisibility,
    askToUploadAfterGame: preferences.askToUploadAfterGame,
    source: "deeplink",
    gameWindowHandle: null,
    isGameRunning: () => isGameRunning(gameKey),
    ...(signedOut ? { ownerId: null } : {}),
    extra: { isDevCapture: true },
  });
};

export const simulateGameClosed = (shop: GameShop, objectId: string) => {
  const gameKey = getGameKey(shop, objectId);
  simulatedRunningGameKeys.delete(gameKey);
  onScreenshotGameClosed(gameKey);
};

export const createDevThumbnail = async (label: string) => {
  const rendered = await renderImage(
    { kind: "pattern", width: 1280, height: 720 },
    label
  );
  const directory = path.join(
    SystemPath.getPath("temp"),
    "hydra-screenshots-dev"
  );
  await fs.promises.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${randomUUID()}.jpeg`);
  await fs.promises.writeFile(filePath, rendered.data);
  return filePath;
};
