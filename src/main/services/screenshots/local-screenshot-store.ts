import { screenshotsSublevel } from "@main/level";
import type { LocalScreenshot } from "@types";

type LocalScreenshotsChangeListener = (screenshots: LocalScreenshot[]) => void;

const listeners = new Set<LocalScreenshotsChangeListener>();

const sortByCapturedAtDescending = (screenshots: LocalScreenshot[]) =>
  screenshots.toSorted((a, b) => b.capturedAt - a.capturedAt);

const notifyListeners = async () => {
  if (!listeners.size) return;
  const screenshots = await LocalScreenshotStore.list();
  for (const listener of listeners) listener(screenshots);
};

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

  public static get(clientId: string) {
    return screenshotsSublevel.get(clientId).catch(() => null);
  }

  public static async put(screenshot: LocalScreenshot) {
    await screenshotsSublevel.put(screenshot.clientId, screenshot);
    await notifyListeners();
    return screenshot;
  }

  public static async update(
    clientId: string,
    changes:
      | Partial<LocalScreenshot>
      | ((current: LocalScreenshot) => Partial<LocalScreenshot>)
  ) {
    const current = await this.get(clientId);
    if (!current) return null;

    const patch = typeof changes === "function" ? changes(current) : changes;
    const updated = { ...current, ...patch, clientId };
    await screenshotsSublevel.put(clientId, updated);
    await notifyListeners();
    return updated;
  }

  public static async updateWithoutNotification(
    clientId: string,
    changes: Partial<LocalScreenshot>
  ) {
    const current = await this.get(clientId);
    if (!current) return null;

    const updated = { ...current, ...changes, clientId };
    await screenshotsSublevel.put(clientId, updated);
    return updated;
  }

  public static async delete(clientId: string) {
    await screenshotsSublevel.del(clientId);
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
