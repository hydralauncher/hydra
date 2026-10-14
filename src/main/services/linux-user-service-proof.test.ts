import assert from "node:assert/strict";
import test from "node:test";
import { isVerifiedLinuxUserService } from "./linux-user-service-proof.js";

const wake = "0000000800000000";
function fixture(
  options: {
    spoofExe?: boolean;
    noAuthority?: boolean;
    noCapability?: boolean;
    writableBinary?: boolean;
    reused?: boolean;
    wrongUid?: boolean;
    protectedExe?: boolean;
  } = {}
) {
  const uid = process.getuid?.() ?? 1000;
  let reads = 0;
  const statText = (pid: number) =>
    `${pid} (${pid === 100 ? "systemd" : "(sd-pam)"}) ${["S", pid === 100 ? "1" : "100", ...Array(17).fill("0"), options.reused && ++reads > 1 ? "99" : "10"].join(" ")}`;
  const filesystem = {
    stat: async (file: string) => ({
      uid: file.startsWith("/proc/") ? (options.wrongUid ? uid + 1 : uid) : 0,
      mode: options.writableBinary ? 0o100777 : 0o100755,
      isFile: () => true,
    }),
    realpath: async (file: string) => {
      if (options.protectedExe && file.startsWith("/proc/"))
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      return file.startsWith("/proc/")
        ? options.spoofExe
          ? "/home/user/fake-systemd"
          : file.includes("/100/")
            ? "/usr/lib/systemd/systemd"
            : "/usr/lib/systemd/systemd-executor"
        : file;
    },
    readFile: async (file: string) => {
      const pid = Number(file.split("/")[2]);
      if (file.endsWith("/stat")) return statText(pid);
      if (file.endsWith("/cmdline"))
        return pid === 100
          ? "/usr/lib/systemd/systemd\0--user\0"
          : "(sd-pam)\0";
      if (file.endsWith("/cgroup"))
        return `0::/user.slice/user-${uid}.slice/user@${uid}.service/init.scope\n`;
      if (file.endsWith("/status"))
        return `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\nCapAmb:\t0\nCapInh:\t${options.noCapability ? "0" : wake}\nCapPrm:\t${pid === 100 && !options.noCapability ? wake : "0"}\nCapEff:\t${pid === 100 && !options.noCapability ? wake : "0"}\n`;
      throw new Error("unexpected file");
    },
  };
  return {
    filesystem,
    manager: async () =>
      options.noAuthority ? null : { pid: 100, start: "10" },
  };
}

test(
  "protected systemd infrastructure requires the authoritative service, trusted executable, capabilities and stable identity",
  { skip: process.platform !== "linux" },
  async () => {
    const good = fixture();
    assert.equal(
      await isVerifiedLinuxUserService(
        100,
        good.filesystem as never,
        good.manager
      ),
      true
    );
    const protectedGood = fixture({ protectedExe: true });
    assert.equal(
      await isVerifiedLinuxUserService(
        100,
        protectedGood.filesystem as never,
        protectedGood.manager
      ),
      true
    );
    assert.equal(
      await isVerifiedLinuxUserService(
        101,
        protectedGood.filesystem as never,
        protectedGood.manager
      ),
      true
    );
    assert.equal(
      await isVerifiedLinuxUserService(
        101,
        good.filesystem as never,
        good.manager
      ),
      true
    );
    for (const options of [
      { spoofExe: true },
      { noAuthority: true },
      { noCapability: true },
      { writableBinary: true },
      { reused: true },
      { wrongUid: true },
    ]) {
      const bad = fixture(options);
      assert.equal(
        await isVerifiedLinuxUserService(
          100,
          bad.filesystem as never,
          bad.manager
        ),
        false,
        JSON.stringify(options)
      );
    }
  }
);
