import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  EPIC_LINUX_SYSTEMD_PROOF_CACHE_MS,
  EPIC_LINUX_SYSTEMD_PROOF_TIMEOUT_MS,
} from "./epic/linux-runtime-constants.js";

type ProofFilesystem = Pick<typeof fs, "stat" | "readFile" | "realpath">;
const execute = promisify(execFile);
const wakeAlarm = 1n << 35n;
const managerCache = new Map<
  number,
  { expires: number; value: Promise<{ pid: number; start: string } | null> }
>();

function identity(stat: string) {
  const end = stat.lastIndexOf(")");
  const fields = stat
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  if (end < 0 || !/^\d+$/.test(fields[19] ?? ""))
    throw new Error("invalid-response");
  return {
    comm: stat.slice(stat.indexOf("(") + 1, end),
    parent: Number(fields[1]),
    start: fields[19],
  };
}
async function trustedBinary(file: string, filesystem: ProofFilesystem) {
  const real = await filesystem.realpath(file);
  const info = await filesystem.stat(real);
  if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) !== 0)
    throw new Error("invalid-response");
  let parent = path.dirname(real);
  for (;;) {
    const directory = await filesystem.stat(parent);
    if (directory.uid !== 0 || (directory.mode & 0o022) !== 0)
      throw new Error("invalid-response");
    if (parent === "/") break;
    parent = path.dirname(parent);
  }
  return real;
}
async function authoritativeManager(uid: number) {
  let cached = managerCache.get(uid);
  if (!cached || cached.expires <= Date.now()) {
    const value = (async () => {
      try {
        const command = await trustedBinary("/usr/bin/systemctl", fs);
        const { stdout } = await execute(
          command,
          [
            "--no-pager",
            "--system",
            "show",
            `user@${uid}.service`,
            "--property=MainPID",
            "--value",
          ],
          {
            timeout: EPIC_LINUX_SYSTEMD_PROOF_TIMEOUT_MS,
            maxBuffer: 256,
            env: {
              PATH: "/usr/bin:/bin",
              LANG: "C",
              SYSTEMD_COLORS: "0",
              SYSTEMD_PAGER: "cat",
            },
          }
        );
        if (!/^[1-9]\d*\s*$/.test(stdout)) return null;
        const pid = Number(stdout.trim());
        return {
          pid,
          start: identity(await fs.readFile(`/proc/${pid}/stat`, "utf8")).start,
        };
      } catch {
        return null;
      }
    })();
    cached = { expires: Date.now() + EPIC_LINUX_SYSTEMD_PROOF_CACHE_MS, value };
    managerCache.set(uid, cached);
  }
  return cached.value;
}

/** Excludes only the system service's authenticated manager/PAM infrastructure.
 * Their privileged capability makes /proc/environ unreadable on normal Linux.
 * A process name, user-writable cgroup or argv alone never establishes proof. */
export async function isVerifiedLinuxUserService(
  pid: number,
  filesystem: ProofFilesystem = fs,
  manager: (
    uid: number
  ) => Promise<{ pid: number; start: string } | null> = authoritativeManager
): Promise<boolean> {
  try {
    const directory = `/proc/${pid}`;
    const info = await filesystem.stat(directory);
    const uid = process.getuid?.();
    if (uid === undefined || info.uid !== uid) return false;
    const before = identity(
      await filesystem.readFile(`${directory}/stat`, "utf8")
    );
    const status = await filesystem.readFile(`${directory}/status`, "utf8");
    const fields = (key: string) =>
      status.match(new RegExp(`^${key}:\\s+([^\\n]+)$`, "m"))?.[1].trim();
    if (
      fields("Uid")
        ?.split(/\s+/)
        .some((value) => Number(value) !== uid) !== false
    )
      return false;
    const cap = (key: string) => BigInt(`0x${fields(key) ?? "invalid"}`);
    const argv = (await filesystem.readFile(`${directory}/cmdline`, "utf8"))
      .split("\0")
      .filter(Boolean);
    const group = (
      await filesystem.readFile(`${directory}/cgroup`, "utf8")
    ).trim();
    const expectedGroup = `0::/user.slice/user-${uid}.slice/user@${uid}.service/init.scope`;
    if (group !== expectedGroup || cap("CapAmb") !== 0n) return false;
    const authoritative = await manager(uid);
    if (!authoritative) return false;
    let expected: string;
    if (before.comm === "systemd") {
      if (
        before.parent !== 1 ||
        authoritative.pid !== pid ||
        authoritative.start !== before.start ||
        argv.length !== 2 ||
        argv[1] !== "--user" ||
        !["/usr/lib/systemd/systemd", "/lib/systemd/systemd"].includes(
          argv[0]
        ) ||
        cap("CapPrm") !== wakeAlarm ||
        cap("CapEff") !== wakeAlarm ||
        cap("CapInh") !== wakeAlarm
      )
        return false;
      expected = await trustedBinary(argv[0], filesystem);
    } else if (before.comm === "(sd-pam)") {
      if (
        before.parent !== authoritative.pid ||
        argv.length !== 1 ||
        argv[0] !== "(sd-pam)" ||
        cap("CapInh") !== wakeAlarm ||
        cap("CapEff") !== 0n ||
        cap("CapPrm") !== 0n ||
        !(await isVerifiedLinuxUserService(before.parent, filesystem, manager))
      )
        return false;
      expected = await trustedBinary(
        "/usr/lib/systemd/systemd-executor",
        filesystem
      );
    } else return false;
    try {
      // If executable inspection is available, a divergent executable rejects
      // even an otherwise convincing comm/argv/service fixture.
      if ((await filesystem.realpath(`${directory}/exe`)) !== expected)
        return false;
    } catch (error) {
      if (
        !["EACCES", "EPERM"].includes(
          (error as NodeJS.ErrnoException).code ?? ""
        )
      )
        return false;
      // PID1's service identity plus kernel capability are the fallback proof.
    }
    const after = identity(
      await filesystem.readFile(`${directory}/stat`, "utf8")
    );
    return (
      before.start === after.start &&
      before.parent === after.parent &&
      (await filesystem.stat(directory)).uid === uid
    );
  } catch {
    return false;
  }
}
