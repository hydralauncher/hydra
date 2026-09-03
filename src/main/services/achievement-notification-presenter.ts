import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  AchievementNotificationRequest,
} from "@types";

export const ACHIEVEMENT_NOTIFICATION_HOST_READY_TIMEOUT = 5_000;
export const ACHIEVEMENT_NOTIFICATION_CONTENT_READY_TIMEOUT = 5_000;
export const ACHIEVEMENT_NOTIFICATION_COMPLETION_TIMEOUT = 6_450;

export type AchievementNotificationRendererEvent =
  | { type: "host-ready" }
  | { type: "content-ready"; requestId: string }
  | { type: "finished"; requestId: string }
  | { type: "failed"; requestId?: string; reason?: string };

export interface AchievementNotificationHost {
  readonly webContentsId: number;
  load(): Promise<void>;
  send(channel: string, ...args: unknown[]): void;
  setPosition(position: AchievementCustomNotificationPosition): Promise<void>;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  isDestroyed(): boolean;
  onFailure(listener: (reason: string) => void): void;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;
type NotificationFallback = () => void | Promise<void>;

interface FallbackReference {
  callback?: NotificationFallback;
  invoked: boolean;
}

interface QueueItem {
  request: AchievementNotificationRequest;
  fallback: FallbackReference;
}

export interface AchievementNotificationPresenterDependencies {
  createHost(
    position: AchievementCustomNotificationPosition
  ): Promise<AchievementNotificationHost>;
  setTimeout(callback: () => void, delay: number): TimeoutHandle;
  clearTimeout(timeout: TimeoutHandle): void;
  log(message: string, ...args: unknown[]): void;
  logError(message: string, ...args: unknown[]): void;
}

type PresenterStage =
  | "idle"
  | "loading"
  | "ready"
  | "positioning"
  | "preparing"
  | "visible";

export class AchievementNotificationPresenter {
  private queue: QueueItem[] = [];
  private activeItem: QueueItem | null = null;
  private host: AchievementNotificationHost | null = null;
  private stage: PresenterStage = "idle";
  private requestSequence = 0;
  private generation = 0;
  private creatingHost = false;
  private watchdog: TimeoutHandle | null = null;

  constructor(
    private readonly dependencies: AchievementNotificationPresenterDependencies
  ) {}

  public enqueueAchievements(
    position: AchievementCustomNotificationPosition,
    achievements: AchievementNotificationInfo[],
    fallback?: NotificationFallback
  ): void {
    if (!achievements.length) return;

    const fallbackReference: FallbackReference = {
      callback: fallback,
      invoked: false,
    };

    this.queue.push(
      ...achievements.map((achievement) => ({
        request: {
          id: this.nextRequestId(),
          type: "achievement" as const,
          position,
          achievement,
        },
        fallback: fallbackReference,
      }))
    );

    this.ensureHost();
  }

  public enqueueCombined(
    position: AchievementCustomNotificationPosition,
    gameCount: number,
    achievementCount: number,
    fallback?: NotificationFallback
  ): void {
    if (gameCount <= 0 || achievementCount <= 0) return;

    this.queue.push({
      request: {
        id: this.nextRequestId(),
        type: "combined",
        position,
        gameCount,
        achievementCount,
      },
      fallback: { callback: fallback, invoked: false },
    });

    this.ensureHost();
  }

  public notifyThemeUpdated(): void {
    if (!this.host || this.host.isDestroyed()) return;
    this.host.send("on-custom-theme-updated");
  }

  public handleRendererEvent(
    senderId: number,
    event: AchievementNotificationRendererEvent
  ): void {
    const host = this.host;
    if (!host || host.isDestroyed() || host.webContentsId !== senderId) return;

    if (event.type === "host-ready") {
      this.handleHostReadyEvent();
      return;
    }

    if (event.type === "failed") {
      this.handleFailedEvent(event);
      return;
    }

    if (this.activeItem?.request.id !== event.requestId) return;
    const activeRequest = this.activeItem.request;

    if (event.type === "content-ready") {
      this.handleContentReadyEvent(host, activeRequest.id);
      return;
    }

    this.handleFinishedEvent(host);
  }

  private handleHostReadyEvent(): void {
    if (this.stage !== "loading") return;
    this.clearWatchdog();
    this.stage = "ready";
    this.processNext();
  }

  private handleFailedEvent(
    event: Extract<AchievementNotificationRendererEvent, { type: "failed" }>
  ): void {
    if (event.requestId && event.requestId !== this.activeItem?.request.id) {
      return;
    }

    this.failHost(event.reason ?? "notification renderer failed");
  }

  private handleContentReadyEvent(
    host: AchievementNotificationHost,
    requestId: string
  ): void {
    if (this.stage !== "preparing") return;

    this.clearWatchdog();

    try {
      host.showInactive();
      this.stage = "visible";
      host.send("start-achievement-notification", requestId);
      this.startWatchdog(
        ACHIEVEMENT_NOTIFICATION_COMPLETION_TIMEOUT,
        "notification animation timed out"
      );
    } catch (error) {
      this.failHost("failed to show notification window", error);
    }
  }

  private handleFinishedEvent(host: AchievementNotificationHost): void {
    if (this.stage !== "visible") return;

    this.clearWatchdog();
    try {
      host.hide();
    } catch (error) {
      this.dependencies.logError(
        "Failed to hide achievement notification window",
        error
      );
    }

    this.activeItem = null;

    if (this.queue.length) {
      this.stage = "ready";
      this.processNext();
    } else {
      this.destroyHost();
    }
  }

  public dispose(): void {
    this.generation += 1;
    this.queue = [];
    this.activeItem = null;
    this.creatingHost = false;
    this.clearWatchdog();
    this.destroyCurrentHost();
    this.stage = "idle";
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `achievement-notification-${this.requestSequence}`;
  }

  private ensureHost(): void {
    if (this.host || this.creatingHost || !this.queue.length) return;

    const generation = this.generation;
    const position = this.queue[0].request.position;
    this.creatingHost = true;

    void this.dependencies
      .createHost(position)
      .then((host) => {
        if (generation !== this.generation || !this.queue.length) {
          if (!host.isDestroyed()) host.destroy();
          return;
        }

        this.creatingHost = false;
        this.host = host;
        this.stage = "loading";

        host.onFailure((reason) => {
          if (this.host !== host) return;
          this.failHost(reason);
        });

        this.startWatchdog(
          ACHIEVEMENT_NOTIFICATION_HOST_READY_TIMEOUT,
          "notification renderer did not become ready"
        );

        void host.load().catch((error) => {
          if (this.host !== host) return;
          this.failHost("failed to load notification renderer", error);
        });
      })
      .catch((error) => {
        if (generation !== this.generation) return;
        this.creatingHost = false;
        this.failHost("failed to create notification window", error);
      });
  }

  private processNext(): void {
    const host = this.host;
    if (!host || host.isDestroyed() || this.stage !== "ready") return;

    const nextItem = this.queue.shift();
    if (!nextItem) {
      this.destroyHost();
      return;
    }

    this.activeItem = nextItem;
    this.stage = "positioning";
    const requestId = nextItem.request.id;

    void host
      .setPosition(nextItem.request.position)
      .then(() => {
        if (
          this.host !== host ||
          this.activeItem?.request.id !== requestId ||
          this.stage !== "positioning"
        ) {
          return;
        }

        this.stage = "preparing";
        host.send("prepare-achievement-notification", nextItem.request);
        this.startWatchdog(
          ACHIEVEMENT_NOTIFICATION_CONTENT_READY_TIMEOUT,
          "notification content did not become ready"
        );
      })
      .catch((error) => {
        if (this.host !== host) return;
        this.failHost("failed to position notification window", error);
      });
  }

  private startWatchdog(delay: number, reason: string): void {
    this.clearWatchdog();
    this.watchdog = this.dependencies.setTimeout(() => {
      this.watchdog = null;
      this.failHost(reason);
    }, delay);
  }

  private clearWatchdog(): void {
    if (!this.watchdog) return;
    this.dependencies.clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private failHost(reason: string, error?: unknown): void {
    if (!this.host && !this.creatingHost && !this.queue.length) return;

    this.dependencies.logError(
      `Achievement notification host failed: ${reason}`,
      ...(error === undefined ? [] : [error])
    );

    const failedItems = [
      ...(this.activeItem ? [this.activeItem] : []),
      ...this.queue,
    ];

    this.generation += 1;
    this.queue = [];
    this.activeItem = null;
    this.creatingHost = false;
    this.clearWatchdog();
    this.destroyCurrentHost();
    this.stage = "idle";

    const fallbacks = new Set(failedItems.map((item) => item.fallback));
    for (const fallback of fallbacks) {
      if (!fallback.callback || fallback.invoked) continue;
      fallback.invoked = true;
      void Promise.resolve(fallback.callback()).catch((fallbackError) => {
        this.dependencies.logError(
          "Achievement notification fallback failed",
          fallbackError
        );
      });
    }
  }

  private destroyHost(): void {
    this.generation += 1;
    this.clearWatchdog();
    this.destroyCurrentHost();
    this.stage = "idle";
    this.dependencies.log("Achievement notification window destroyed");
  }

  private destroyCurrentHost(): void {
    const host = this.host;
    this.host = null;

    if (!host || host.isDestroyed()) return;

    try {
      host.hide();
      host.destroy();
    } catch (error) {
      this.dependencies.logError(
        "Failed to destroy achievement notification window",
        error
      );
    }
  }
}
