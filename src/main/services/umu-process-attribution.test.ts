import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectLinuxInvocationProcesses,
  inspectLinuxPrefixProcesses,
} from "./umu-supervised-process.js";
import { EPIC_LINUX_INVOCATION_ENV } from "./epic/linux-runtime-constants.js";

const invocationId = "synthetic-invocation";
const invocationEnvironment = `${EPIC_LINUX_INVOCATION_ENV}=${invocationId}\0`;
const denied = (code = "EACCES") => Object.assign(new Error(code), { code });

interface ProcessFixture {
  parentPid?: number;
  startTime?: string;
  identities?: (string | Error)[];
  environments?: (string | Error)[];
}

function processFilesystem(initial: [number, ProcessFixture][]) {
  const processes = new Map(initial);
  const next = <T>(values: T[] | undefined, fallback: T): T => {
    if (!values?.length) return fallback;
    return values.length > 1 ? values.shift()! : values[0];
  };
  const filesystem = {
    readdir: async (_directory: string, options?: unknown) => {
      assert.equal(
        options,
        undefined,
        "enumerate names without racing Dirent lstat"
      );
      return [...processes.keys()].map(String);
    },
    stat: async () => ({ uid: process.getuid?.() ?? 0 }),
    realpath: async (value: string) => value,
    readFile: async (file: string) => {
      const pid = Number(file.split("/")[2]);
      const entry = processes.get(pid);
      if (!entry) throw denied("ENOENT");
      if (file.endsWith("/environ")) {
        const environment = next(entry.environments, "");
        if (environment instanceof Error) throw environment;
        return Buffer.from(environment);
      }
      assert.ok(file.endsWith("/stat"));
      const startTime = next(entry.identities, entry.startTime ?? "10");
      if (startTime instanceof Error) throw startTime;
      const fields = [
        "S",
        String(entry.parentPid ?? 1),
        ...Array(17).fill("0"),
        startTime,
      ];
      return `${pid} (fixture) ${fields.join(" ")}`;
    },
  };
  return { processes, filesystem: filesystem as never };
}

test("unreadable unrelated processes cannot occupy a prefix or an invocation", async () => {
  const f = processFilesystem([
    [100, { environments: [denied()] }],
    [101, { environments: [denied("EPERM")] }],
    [102, { identities: [denied()] }],
    [103, { environments: ["WINEPREFIX=/other-prefix\0"] }],
  ]);
  const known = new Map<number, string>();
  assert.deepEqual(
    await inspectLinuxInvocationProcesses(invocationId, known, f.filesystem),
    []
  );
  assert.equal(known.size, 0);
  assert.equal(
    await inspectLinuxPrefixProcesses("/prefix", f.filesystem),
    false
  );
});

test("invocation tags and known identities still select processes beside protected unrelated daemons", async () => {
  const f = processFilesystem([
    [100, { environments: [invocationEnvironment] }],
    [101, { environments: [""] }],
    [102, { environments: [denied()] }],
  ]);
  const known = new Map([[101, "10"]]);
  const selected = await inspectLinuxInvocationProcesses(
    invocationId,
    known,
    f.filesystem
  );
  assert.deepEqual(selected.map(({ pid }) => pid).sort(), [100, 101]);
  assert.deepEqual([...known.keys()].sort(), [100, 101]);
  f.processes.set(101, { environments: [denied()] });
  await assert.rejects(
    inspectLinuxInvocationProcesses(invocationId, known, f.filesystem),
    { code: "cleanup-failed" }
  );
});

test("inaccessible descendants are retained before failure and after reparenting", async () => {
  const f = processFilesystem([
    [102, { parentPid: 101, environments: [denied("EPERM")] }],
    [101, { parentPid: 100, environments: [denied()] }],
    [100, { environments: [invocationEnvironment] }],
  ]);
  const known = new Map<number, string>();
  await assert.rejects(
    inspectLinuxInvocationProcesses(invocationId, known, f.filesystem),
    { code: "cleanup-failed" }
  );
  assert.deepEqual([...known.keys()].sort(), [100, 101, 102]);
  f.processes.delete(100);
  f.processes.set(101, { parentPid: 1, environments: [denied()] });
  await assert.rejects(
    inspectLinuxInvocationProcesses(invocationId, known, f.filesystem),
    { code: "cleanup-failed" }
  );
  f.processes.set(101, { parentPid: 1 });
  f.processes.set(102, { parentPid: 1 });
  assert.deepEqual(
    (await inspectLinuxInvocationProcesses(invocationId, known, f.filesystem))
      .map(({ pid }) => pid)
      .sort(),
    [101, 102]
  );
});

test("a reused known PID and its unrelated children are not invocation signal candidates", async () => {
  const f = processFilesystem([
    [100, { startTime: "20", environments: [denied()] }],
    [101, { parentPid: 100 }],
  ]);
  const known = new Map([[100, "10"]]);
  assert.deepEqual(
    await inspectLinuxInvocationProcesses(invocationId, known, f.filesystem),
    []
  );
  assert.equal(known.size, 0);
});

test("invocation attribution discards a token read before PID replacement", async () => {
  const f = processFilesystem([
    [
      100,
      {
        identities: ["10", "20", "20", "20"],
        environments: [invocationEnvironment, ""],
      },
    ],
  ]);
  const known = new Map<number, string>();
  assert.deepEqual(
    await inspectLinuxInvocationProcesses(invocationId, known, f.filesystem),
    []
  );
  assert.equal(known.size, 0);
  f.processes.set(100, {
    identities: ["30", "40", "50", "60"],
    environments: [invocationEnvironment],
  });
  assert.deepEqual(
    await inspectLinuxInvocationProcesses(invocationId, known, f.filesystem),
    []
  );
  assert.equal(known.size, 0);
});

test("partial identity verification cannot declare an attributed process closed", async () => {
  const f = processFilesystem([
    [
      100,
      {
        identities: ["10", denied()],
        environments: [invocationEnvironment],
      },
    ],
  ]);
  const known = new Map<number, string>();
  await assert.rejects(
    inspectLinuxInvocationProcesses(invocationId, known, f.filesystem),
    { code: "cleanup-failed" }
  );
  assert.equal(known.get(100), "10");
  f.processes.set(100, { identities: [denied()] });
  await assert.rejects(
    inspectLinuxInvocationProcesses(invocationId, known, f.filesystem),
    { code: "cleanup-failed" }
  );
});

test("a previously observed prefix remains busy through denied inspection until process exit or reuse", async () => {
  const f = processFilesystem([
    [100, { environments: ["WINEPREFIX=/prefix\0"] }],
  ]);
  const known = new Map<number, string>();
  const inspect = () =>
    inspectLinuxPrefixProcesses("/prefix", f.filesystem, known);
  assert.equal(await inspect(), true);
  assert.equal(known.get(100), "10");
  f.processes.set(100, { environments: [denied()] });
  assert.equal(await inspect(), true);
  f.processes.set(100, { identities: [denied()] });
  assert.equal(await inspect(), true);
  f.processes.delete(100);
  assert.equal(await inspect(), false);
  assert.equal(known.size, 0);
  f.processes.set(100, { environments: ["WINEPREFIX=/prefix\0"] });
  assert.equal(await inspect(), true);
  f.processes.set(100, { startTime: "20", environments: [denied()] });
  assert.equal(await inspect(), false);
  assert.equal(known.size, 0);
});

test("prefix inspection discards a prefix read before PID replacement", async () => {
  const f = processFilesystem([
    [
      100,
      {
        identities: ["10", "20", "20", "20"],
        environments: ["WINEPREFIX=/prefix\0", "WINEPREFIX=/other-prefix\0"],
      },
    ],
  ]);
  const known = new Map<number, string>();
  assert.equal(
    await inspectLinuxPrefixProcesses("/prefix", f.filesystem, known),
    false
  );
  assert.equal(known.size, 0);
});
