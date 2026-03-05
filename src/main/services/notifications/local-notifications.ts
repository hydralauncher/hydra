import { localNotificationsSublevel } from "@main/level";
import { WindowManager } from "../window-manager";
import type { LocalNotification, LocalNotificationType } from "@types";
import crypto from "node:crypto";

export class LocalNotificationManager {
  private static generateId(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  static async createNotification(
    type: LocalNotificationType,
    title: string,
    description: string,
    options?: {
      pictureUrl?: string | null;
      url?: string | null;
    }
  ): Promise<LocalNotification> {
    const id = this.generateId();
    const notification: LocalNotification = {
      id,
      type,
      title,
      description,
      pictureUrl: options?.pictureUrl ?? null,
      url: options?.url ?? null,
      isRead: false,
      createdAt: new Date().toISOString(),
    };

    await localNotificationsSublevel.put(id, notification);

    // Notify renderer about new notification
    if (WindowManager.mainWindow) {
      WindowManager.mainWindow.webContents.send(
        "on-local-notification-created",
        notification
      );
    }

    return notification;
  }

  static async getNotifications(): Promise<LocalNotification[]> {
    const notifications: LocalNotification[] = [];

    for await (const [, value] of localNotificationsSublevel.iterator()) {
      notifications.push(value);
    }

    // Sort by createdAt descending
    return notifications.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  static async getUnreadCount(): Promise<number> {
    let count = 0;

    for await (const [, value] of localNotificationsSublevel.iterator()) {
      if (!value.isRead) {
        count++;
      }
    }

    return count;
  }

  static async markAsRead(id: string): Promise<void> {
    const notification = await localNotificationsSublevel.get(id);
    if (notification) {
      notification.isRead = true;
      await localNotificationsSublevel.put(id, notification);
    }
  }

  static async markAllAsRead(): Promise<void> {
    const batch = localNotificationsSublevel.batch();

    for await (const [key, value] of localNotificationsSublevel.iterator()) {
      if (!value.isRead) {
        value.isRead = true;
        batch.put(key, value);
      }
    }

    await batch.write();
  }

  static async deleteNotification(id: string): Promise<void> {
    await localNotificationsSublevel.del(id);
  }

  static async clearAll(): Promise<void> {
    await localNotificationsSublevel.clear();
  }
}
