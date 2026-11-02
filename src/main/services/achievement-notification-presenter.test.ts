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
  public shownFrameCount = 0;
  public failShownFrame: Error | null = null;
  public failStartSend = false;
  public shownFramePromise: Promise<void> | null = null;
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
    if (this.failStartSend && channel === "start-achievement-notification") {
      throw new Error("start send failed");
    }
    this.messages.push({ channel, args });
  }

  public async setPosition(position: string): Promise<void> {
    this.positions.push(position);
  }

  public showInactive(): void {
    this.showInactiveCount += 1;
  }

  public waitForFramesAfterShow(): Promise<void> {
    this.shownFrameCount += 1;
    if (this.failShownFrame) return Promise.reject(this.failShownFrame);
    return this.shownFramePromise ?? Promise.resolve();
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

  public latestPreparedRequest(): { id: string; batchId: string } {
    const message = this.host.messages.findLast(
      ({ channel }) => channel === "prepare-achievement-notification"
    );
    assert.ok(message);
    return message.args[0] as { id: string; batchId: string };
  }

  public latestPreparedRequestId(): string {
    return this.latestPreparedRequest().id;
  }

  public async prepareAchievement(fallback?: () => void): Promise<string> {
    this.presenter.enqueueAchievements(
      "top-left",
      [achievement("first")],
      fallback
    );
    await this.flush();
    this.presenter.handleRendererEvent(this.host.webContentsId, {
      type: "host-ready",
    });
    await this.flush();
    return this.latestPreparedRequestId();
  }

  public async contentReady(requestId: string): Promise<void> {
    this.presenter.handleRendererEvent(this.host.webContentsId, {
      type: "content-ready",
      requestId,
    });
    await this.flush();
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
  it("shows the host only after content readiness and starts the animation after the post-show frame wait", async () => {
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

    assert.equal(harness.host.showInactiveCount, 0);
    const requestId = harness.latestPreparedRequestId();
    assert.equal(
      harness.host.messages.at(-1)?.channel,
      "prepare-achievement-notification"
    );

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId,
    });
    await harness.flush();

    assert.equal(harness.host.showInactiveCount, 1);
    assert.equal(harness.host.shownFrameCount, 1);
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
    await harness.flush();
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
    await harness.flush();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: secondId,
    });

    assert.equal(harness.host.showInactiveCount, 2);
    assert.equal(harness.host.destroyCount, 1);
    assert.equal(harness.createCount, 1);
  });

  it("keeps one batch id across a burst and starts a new batch afterwards", async () => {
    const harness = new PresenterHarness();

    harness.presenter.enqueueAchievements("top-left", [
      achievement("first"),
      achievement("second"),
    ]);
    harness.presenter.enqueueAchievements("top-left", [achievement("third")]);
    await harness.flush();

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });
    await harness.flush();

    const first = harness.latestPreparedRequest();
    await harness.contentReady(first.id);
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: first.id,
    });
    await harness.flush();

    const second = harness.latestPreparedRequest();
    assert.equal(second.batchId, first.batchId);
    assert.notEqual(second.id, first.id);

    await harness.contentReady(second.id);
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: second.id,
    });
    await harness.flush();

    const third = harness.latestPreparedRequest();
    assert.notEqual(third.batchId, first.batchId);
  });

  it("does not start the animation until the shown frame is reported", async () => {
    const harness = new PresenterHarness();
    let resolveShownFrame = () => {};
    harness.host.shownFramePromise = new Promise<void>((resolve) => {
      resolveShownFrame = resolve;
    });

    const requestId = await harness.prepareAchievement();
    await harness.contentReady(requestId);

    assert.equal(harness.host.shownFrameCount, 1);
    assert.notEqual(
      harness.host.messages.at(-1)?.channel,
      "start-achievement-notification"
    );

    resolveShownFrame();
    await harness.flush();

    assert.deepEqual(harness.host.messages.at(-1), {
      channel: "start-achievement-notification",
      args: [requestId],
    });
  });

  it("fails closed when the notification window never reports a frame", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.host.shownFramePromise = new Promise<void>(() => {});

    const requestId = await harness.prepareAchievement(() => {
      fallbackCount += 1;
    });
    await harness.contentReady(requestId);

    harness.runLatestTimer();
    await harness.flush();

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
    assert.equal(
      harness.host.messages.some(
        ({ channel }) => channel === "start-achievement-notification"
      ),
      false
    );
  });

  it("ignores a duplicate content-ready event while showing", async () => {
    const harness = new PresenterHarness();
    let resolveShownFrame = () => {};
    harness.host.shownFramePromise = new Promise<void>((resolve) => {
      resolveShownFrame = resolve;
    });

    const requestId = await harness.prepareAchievement();
    await harness.contentReady(requestId);
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId,
    });
    await harness.flush();

    assert.equal(harness.host.shownFrameCount, 1);

    resolveShownFrame();
    await harness.flush();

    const starts = harness.host.messages.filter(
      ({ channel }) => channel === "start-achievement-notification"
    );
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].args, [requestId]);
  });

  it("does not start or fall back when disposed during the frame wait", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    let resolveShownFrame = () => {};
    harness.host.shownFramePromise = new Promise<void>((resolve) => {
      resolveShownFrame = resolve;
    });

    const requestId = await harness.prepareAchievement(() => {
      fallbackCount += 1;
    });
    await harness.contentReady(requestId);

    harness.presenter.dispose();
    resolveShownFrame();
    await harness.flush();

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 0);
    assert.equal(
      harness.host.messages.some(
        ({ channel }) => channel === "start-achievement-notification"
      ),
      false
    );
  });

  it("falls back when the shown frame cannot be reported", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.host.failShownFrame = new Error("shown frame failed");

    const requestId = await harness.prepareAchievement(() => {
      fallbackCount += 1;
    });
    await harness.contentReady(requestId);

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
    assert.equal(
      harness.host.messages.at(-1)?.channel,
      "prepare-achievement-notification"
    );
  });

  it("falls back when the start message cannot be sent", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.host.failStartSend = true;

    const requestId = await harness.prepareAchievement(() => {
      fallbackCount += 1;
    });
    await harness.contentReady(requestId);

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
    assert.equal(
      harness.host.messages.at(-1)?.channel,
      "prepare-achievement-notification"
    );
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
