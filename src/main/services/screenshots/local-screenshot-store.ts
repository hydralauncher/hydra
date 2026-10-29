import { screenshotsSublevel } from "@main/level";
import type { GameShop, LocalScreenshot } from "@types";

import { logger } from "../logger";
import { matchesLocalScreenshotGame } from "./local-screenshot-game";

type LocalScreenshotsChangeListener = (screenshots: LocalScreenshot[]) => void;

type LocalScreenshotChanges =
  | Partial<LocalScreenshot>
  | ((current: LocalScreenshot) => Partial<LocalScreenshot>);

const CHANGE_NOTIFICATION_DELAY_MS = 50;

const listeners = new Set<LocalScreenshotsChangeListener>();
const pendingWrites = new Map<string, Promise<unknown>>();
const deletedClientIds = new Set<string>();

let recordsPromise: Promise<Map<string, LocalScreenshot>> | null = null;
let notificationScheduled = false;

const readAllRecords = async () =>
  new Map(await screenshotsSublevel.iterator().all());

const loadRecords = () => {
  if (recordsPromise !== null) return recordsPromise;
  const loading = readAllRecords().catch((error: unknown) => {
    recordsPromise = null;
    throw error;
  });
  recordsPromise = loading;
  return loading;
};

const cloneAll = (records: Map<string, LocalScreenshot>) =>
  [...records.values()].map((screenshot) => structuredClone(screenshot));

const sortByCapturedAtDescending = (screenshots: LocalScreenshot[]) =>
  screenshots.toSorted((a, b) => b.capturedAt - a.capturedAt);

const listVisible = async () => {
  const screenshots = cloneAll(await loadRecords());
  return sortByCapturedAtDescending(
    screenshots.filter((screenshot) => screenshot.state !== "deleted")
  );
};

const notifyListeners = async () => {
  notificationScheduled = false;
  if (!listeners.size) return;
  const screenshots = await listVisible();
  for (const listener of listeners) listener(screenshots);
};

const scheduleNotification = () => {
  if (notificationScheduled) return;
  notificationScheduled = true;
  setTimeout(() => {
    void notifyListeners().catch((error: unknown) => {
      logger.warn("Failed to notify local screenshot listeners", error);
    });
  }, CHANGE_NOTIFICATION_DELAY_MS);
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

const readScreenshot = async (clientId: string) => {
  const screenshot = (await loadRecords()).get(clientId);
  return screenshot ? structuredClone(screenshot) : null;
};

export class LocalScreenshotStore {
  public static onChange(listener: LocalScreenshotsChangeListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  public static list() {
    return listVisible();
  }

  public static async listIncludingDeleted() {
    return cloneAll(await loadRecords());
  }

  public static async listForGame(shop: GameShop, objectId: string) {
    const screenshots = await LocalScreenshotStore.list();
    return screenshots.filter((screenshot) =>
      matchesLocalScreenshotGame(screenshot, shop, objectId)
    );
  }

  public static get(clientId: string) {
    return readScreenshot(clientId);
  }

  public static async put(screenshot: LocalScreenshot) {
    await runExclusive(screenshot.clientId, async () => {
      const records = await loadRecords();
      deletedClientIds.delete(screenshot.clientId);
      await screenshotsSublevel.put(screenshot.clientId, screenshot);
      records.set(screenshot.clientId, structuredClone(screenshot));
    });
    scheduleNotification();
    return screenshot;
  }

  public static async update(
    clientId: string,
    changes: LocalScreenshotChanges
  ) {
    const updated = await runExclusive(clientId, async () => {
      if (deletedClientIds.has(clientId)) return null;

      const records = await loadRecords();
      const current = records.get(clientId);
      if (!current) return null;

      const patch =
        typeof changes === "function"
          ? changes(structuredClone(current))
          : changes;
      const next = { ...current, ...patch, clientId };
      await screenshotsSublevel.put(clientId, next);
      records.set(clientId, structuredClone(next));
      return next;
    });

    if (updated) scheduleNotification();
    return updated;
  }

  public static async delete(clientId: string) {
    await runExclusive(clientId, async () => {
      const records = await loadRecords();
      deletedClientIds.add(clientId);
      await screenshotsSublevel.del(clientId);
      records.delete(clientId);
    });
    scheduleNotification();
  }

  public static async findByScreenshotId(screenshotId: string) {
    const records = await loadRecords();
    for (const screenshot of records.values()) {
      if (
        screenshot.screenshotId === screenshotId ||
        screenshot.pendingCompleteScreenshotId === screenshotId
      ) {
        return structuredClone(screenshot);
      }
    }
    return null;
  }
}
