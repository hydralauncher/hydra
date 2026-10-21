import { screenshotsSublevel } from "@main/level";
import type { GameShop, LocalScreenshot } from "@types";

import { isLocalScreenshotForGame } from "./local-screenshot-game";

type LocalScreenshotsChangeListener = (screenshots: LocalScreenshot[]) => void;

type LocalScreenshotChanges =
  | Partial<LocalScreenshot>
  | ((current: LocalScreenshot) => Partial<LocalScreenshot>);

const listeners = new Set<LocalScreenshotsChangeListener>();
const pendingWrites = new Map<string, Promise<unknown>>();
const deletedClientIds = new Set<string>();

const sortByCapturedAtDescending = (screenshots: LocalScreenshot[]) =>
  screenshots.toSorted((a, b) => b.capturedAt - a.capturedAt);

const notifyListeners = async () => {
  if (!listeners.size) return;
  const screenshots = await LocalScreenshotStore.list();
  for (const listener of listeners) listener(screenshots);
};

const runExclusive = <T>(clientId: string, task: () => Promise<T>) => {
  const previous = pendingWrites.get(clientId) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.catch(() => undefined);
  pendingWrites.set(clientId, tail);
  void tail.then(() => {
    if (pendingWrites.get(clientId) === tail) pendingWrites.delete(clientId);
  });
  return result;
};

const readScreenshot = (clientId: string) =>
  screenshotsSublevel.get(clientId).catch(() => null);

export class LocalScreenshotStore {
  public static onChange(listener: LocalScreenshotsChangeListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  public static async list() {
    const screenshots = await screenshotsSublevel.values().all();
    return sortByCapturedAtDescending(
      screenshots.filter((screenshot) => screenshot.state !== "deleted")
    );
  }

  public static listIncludingDeleted() {
    return screenshotsSublevel.values().all();
  }

  public static async listForGame(shop: GameShop, objectId: string) {
    const screenshots = await LocalScreenshotStore.list();
    return screenshots.filter((screenshot) =>
      isLocalScreenshotForGame(screenshot, shop, objectId)
    );
  }

  public static get(clientId: string) {
    return readScreenshot(clientId);
  }

  public static async put(screenshot: LocalScreenshot) {
    await runExclusive(screenshot.clientId, async () => {
      deletedClientIds.delete(screenshot.clientId);
      await screenshotsSublevel.put(screenshot.clientId, screenshot);
    });
    await notifyListeners();
    return screenshot;
  }

  public static async update(
    clientId: string,
    changes: LocalScreenshotChanges
  ) {
    const updated = await runExclusive(clientId, async () => {
      if (deletedClientIds.has(clientId)) return null;

      const current = await readScreenshot(clientId);
      if (!current) return null;

      const patch = typeof changes === "function" ? changes(current) : changes;
      const next = { ...current, ...patch, clientId };
      await screenshotsSublevel.put(clientId, next);
      return next;
    });

    if (updated) await notifyListeners();
    return updated;
  }

  public static async delete(clientId: string) {
    await runExclusive(clientId, async () => {
      deletedClientIds.add(clientId);
      await screenshotsSublevel.del(clientId);
    });
    await notifyListeners();
  }

  public static async findByScreenshotId(screenshotId: string) {
    const screenshots = await screenshotsSublevel.values().all();
    return (
      screenshots.find(
        (screenshot) => screenshot.screenshotId === screenshotId
      ) ?? null
    );
  }
}
