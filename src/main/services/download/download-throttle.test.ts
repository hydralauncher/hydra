import assert from "node:assert/strict";
import { it } from "node:test";
import { DownloadThrottle } from "./download-throttle.ts";

it("caps idle credit at one second and still completes chunks larger than the limit", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const throttle = new DownloadThrottle();
  throttle.setLimit(64 * 1024);
  const first = throttle.wait(64 * 1024);
  t.mock.timers.tick(1000);
  await first;
  t.mock.timers.tick(3000);
  let complete = false;
  const next = throttle.wait(192 * 1024).then(() => {
    complete = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(complete, false, "idle time must not fund a three-second burst");
  for (let elapsed = 0; elapsed < 1900; elapsed += 100) t.mock.timers.tick(100);
  t.mock.timers.tick(99);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(complete, false);
  t.mock.timers.tick(1);
  await next;
  assert.equal(complete, true);
});

it("shares bounded idle credit across concurrent workers", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const throttle = new DownloadThrottle();
  throttle.setLimit(1024);
  t.mock.timers.tick(10_000);
  let complete = 0;
  const workers = Array.from({ length: 4 }, () =>
    throttle.wait(1024).then(() => {
      complete++;
    })
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(complete, 1);
  for (let second = 1; second <= 3; second++) {
    t.mock.timers.tick(1000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(complete, second + 1);
  }
  await Promise.all(workers);
});
