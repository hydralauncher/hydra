import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AchievementNotificationHost,
  AchievementNotificationPresenterDependencies,
} from "./achievement-notification-presenter.js";
import { AchievementNotificationPresenter } from "./achievement-notification-presenter.js";

class FakeHost implements AchievementNotificationHost {
  public readonly webContentsId = 42;
  public loadCount = 0;
  public showInactiveCount = 0;
  public hideCount = 0;
  public destroyCount = 0;
  public destroyed = false;
  public positions: string[] = [];
  public messages: Array<{ channel: string; args: unknown[] }> = [];
  private failureListener: ((reason: string) => void) | null = null;

  public async load(): Promise<void> {
    this.loadCount += 1;
  }

  public send(channel: string, ...args: unknown[]): void {
    this.messages.push({ channel, args });
  }

  public async setPosition(position: string): Promise<void> {
    this.positions.push(position);
  }

  public showInactive(): void {
    this.showInactiveCount += 1;
  }

  public hide(): void {
    this.hideCount += 1;
  }

  public destroy(): void {
    this.destroyCount += 1;
    this.destroyed = true;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public onFailure(listener: (reason: string) => void): void {
    this.failureListener = listener;
  }

  public fail(reason: string): void {
    this.failureListener?.(reason);
  }
}

class PresenterHarness {
  public readonly host = new FakeHost();
  public readonly timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  public readonly errors: string[] = [];
  public createCount = 0;

  public readonly presenter = new AchievementNotificationPresenter(
    this.dependencies()
  );

  public async flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  public latestPreparedRequestId(): string {
    const message = this.host.messages.findLast(
      ({ channel }) => channel === "prepare-achievement-notification"
    );
    assert.ok(message);
    return (message.args[0] as { id: string }).id;
  }

  public runLatestTimer(): void {
    const timer = Array.from(this.timers.entries()).at(-1);
    assert.ok(timer);
    this.timers.delete(timer[0]);
    timer[1]();
  }

  private dependencies(): AchievementNotificationPresenterDependencies {
    let timerSequence = 0;

    return {
      createHost: async () => {
        this.createCount += 1;
        return this.host;
      },
      setTimeout: (callback) => {
        timerSequence += 1;
        const handle = timerSequence as unknown as ReturnType<
          typeof setTimeout
        >;
        this.timers.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => {
        this.timers.delete(handle);
      },
      log: () => {},
      logError: (message) => this.errors.push(message),
    };
  }
}

const achievement = (title: string) => ({
  title,
  iconUrl: `https://example.com/${title}.png`,
  isHidden: false,
  isRare: false,
  isPlatinum: false,
});

describe("AchievementNotificationPresenter", () => {
  it("creates a hidden host on demand and shows it only after content readiness", async () => {
    const harness = new PresenterHarness();

    assert.equal(harness.createCount, 0);
    harness.presenter.enqueueAchievements("top-left", [achievement("first")]);
    await harness.flush();

    assert.equal(harness.createCount, 1);
    assert.equal(harness.host.loadCount, 1);
    assert.equal(harness.host.showInactiveCount, 0);

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });
    await harness.flush();

    const requestId = harness.latestPreparedRequestId();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId,
    });

    assert.equal(harness.host.showInactiveCount, 1);
    assert.deepEqual(harness.host.messages.at(-1), {
      channel: "start-achievement-notification",
      args: [requestId],
    });
  });

  it("reuses one host for a burst and destroys it after the queue drains", async () => {
    const harness = new PresenterHarness();
    harness.presenter.enqueueAchievements("top-left", [
      achievement("first"),
      achievement("second"),
    ]);
    await harness.flush();

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });
    await harness.flush();
    const firstId = harness.latestPreparedRequestId();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId: firstId,
    });
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: firstId,
    });
    await harness.flush();

    const secondId = harness.latestPreparedRequestId();
    assert.notEqual(secondId, firstId);
    assert.equal(harness.createCount, 1);
    assert.equal(harness.host.hideCount, 1);

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId: secondId,
    });
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: secondId,
    });

    assert.equal(harness.host.showInactiveCount, 2);
    assert.equal(harness.host.destroyCount, 1);
    assert.equal(harness.createCount, 1);
  });

  it("ignores stale senders and request acknowledgements", async () => {
    const harness = new PresenterHarness();
    harness.presenter.enqueueAchievements("top-left", [achievement("first")]);
    await harness.flush();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });
    await harness.flush();
    const requestId = harness.latestPreparedRequestId();

    harness.presenter.handleRendererEvent(999, {
      type: "content-ready",
      requestId,
    });
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId: "stale-request",
    });

    assert.equal(harness.host.showInactiveCount, 0);
    assert.equal(harness.host.destroyCount, 0);
  });

  it("destroys the host and invokes a batch fallback exactly once on failure", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.presenter.enqueueAchievements(
      "top-left",
      [achievement("first"), achievement("second")],
      () => {
        fallbackCount += 1;
      }
    );
    await harness.flush();

    harness.host.fail("window unexpectedly received focus");
    harness.host.fail("duplicate failure");
    await harness.flush();

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
    assert.equal(harness.errors.length, 1);
  });

  it("fails closed when a readiness watchdog expires", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.presenter.enqueueCombined("bottom-right", 2, 5, () => {
      fallbackCount += 1;
    });
    await harness.flush();

    harness.runLatestTimer();
    await harness.flush();

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
  });

  it("disposes queued work without invoking fallback", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.presenter.enqueueAchievements(
      "top-left",
      [achievement("first")],
      () => {
        fallbackCount += 1;
      }
    );
    await harness.flush();

    harness.presenter.dispose();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 0);
    assert.equal(harness.host.messages.length, 0);
  });
});
