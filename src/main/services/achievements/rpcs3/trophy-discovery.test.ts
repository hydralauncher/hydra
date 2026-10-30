import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { findGameTrophySetIds, resolveTrophyUser } from "./trophy-discovery.js";

it("maps collection trophy IDs from media and keeps RPCS3 users separate", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-trophy-discovery-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ["NPWR12345_00", "NPWR12346_00", "not-a-trophy"])
    await fs.mkdir(path.join(root, "PS3_GAME", "TROPDIR", name), {
      recursive: true,
    });
  assert.deepEqual(await findGameTrophySetIds({ selectedDiscPath: root }), [
    "NPWR12345_00",
    "NPWR12346_00",
  ]);
  const home = path.join(root, "home");
  await fs.mkdir(path.join(home, "00000001"), { recursive: true });
  assert.equal(await resolveTrophyUser(root, home), "00000001");
  await fs.mkdir(path.join(home, "00000002"));
  assert.equal(await resolveTrophyUser(root, home), null);
  await fs.mkdir(path.join(root, "GuiConfigs"));
  await fs.writeFile(
    path.join(root, "GuiConfigs", "persistent_settings.dat"),
    "[Users]\nactive_user=00000002\n"
  );
  assert.equal(await resolveTrophyUser(root, home), "00000002");
});
