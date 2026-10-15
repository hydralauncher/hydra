import assert from "node:assert/strict";
import test from "node:test";
import { observeEpicLinuxLaunch } from "./linux-launch-monitor.js";
import { EPIC_LINUX_LAUNCH_OBSERVATION_MS } from "./linux-runtime-constants.js";
import type { UmuProcessHandle } from "../umu-supervised-process";
import type { UmuStatus } from "../umu-launch-monitor";

type Exit = Awaited<UmuProcessHandle["exited"]>;
const handle = (exited: Promise<Exit>) => ({ exited }) as UmuProcessHandle;

test("rejects an unsuccessful wrapper exit only after proving no game remains", async () => {
  const statuses: UmuStatus[] = [];
  let checked = false;
  await assert.rejects(
    observeEpicLinuxLaunch(handle(Promise.resolve({ code: 1, signal: null })), {
      hasGameProcesses: async () => {
        checked = true;
        return false;
      },
      onStatus: (status) => {
        assert.equal(checked, true);
        statuses.push(status);
      },
    }),
    { code: "compatibility-launch-failed" }
  );
  assert.deepEqual(statuses, [
    { type: "failed", message: "compatibility-launch-failed" },
  ]);
});

test("keeps wrapper failure separate from live games, observed closure and uncertain inspection", async () => {
  for (const scenario of [
    "running",
    "detected",
    "unreadable",
    "success",
  ] as const) {
    const statuses: UmuStatus[] = [];
    await observeEpicLinuxLaunch(
      handle(
        Promise.resolve({ code: scenario === "success" ? 0 : 1, signal: null })
      ),
      {
        wasGameDetected: () => scenario === "detected",
        hasGameProcesses: async () => {
          if (scenario === "unreadable")
            throw new Error("inspection unavailable");
          return scenario === "running";
        },
        onStatus: (status) => statuses.push(status),
      }
    );
    assert.deepEqual(statuses, [], scenario);
  }
});

test("reports a failed startup after the observation window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let exit!: (result: Exit) => void;
  const exited = new Promise<Exit>((resolve) => {
    exit = resolve;
  });
  const statuses: UmuStatus[] = [];
  const startup = observeEpicLinuxLaunch(handle(exited), {
    hasGameProcesses: async () => false,
    onStatus: (status) => statuses.push(status),
  });
  t.mock.timers.tick(EPIC_LINUX_LAUNCH_OBSERVATION_MS);
  await startup;
  assert.deepEqual(statuses, []);
  exit({ code: 2, signal: null });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(statuses, [
    { type: "failed", message: "compatibility-launch-failed" },
  ]);
});

test("cancellation interrupts observation without a launch-failure notification", async () => {
  const controller = new AbortController();
  const statuses: UmuStatus[] = [];
  const startup = observeEpicLinuxLaunch(handle(new Promise<Exit>(() => {})), {
    signal: controller.signal,
    hasGameProcesses: async () => false,
    onStatus: (status) => statuses.push(status),
  });
  controller.abort();
  await assert.rejects(startup, { code: "operation-cancelled" });
  assert.deepEqual(statuses, []);
});
