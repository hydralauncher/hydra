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
  await fs.writeFile(
    path.join(root, "GuiConfigs", "persistent_settings.dat"),
    "[Users]\nactive_user=00000003\n"
  );
  assert.equal(await resolveTrophyUser(root, home), null);
});

it("merges folder and EBOOT media, deduplicating and sorting trophy IDs", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-trophy-collection-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, "selected");
  const disc = path.join(root, "disc", "PS3_GAME");
  await fs.mkdir(path.join(selected, "TROPDIR", "NPWR99999_00"), {
    recursive: true,
  });
  await fs.mkdir(path.join(disc, "TROPDIR", "NPWR12345_00"), {
    recursive: true,
  });
  await fs.mkdir(path.join(disc, "TROPDIR", "NPWR99999_00"));
  const eboot = path.join(disc, "USRDIR", "EBOOT.BIN");
  await fs.mkdir(path.dirname(eboot));
  await fs.writeFile(eboot, "fixture");
  assert.deepEqual(
    await findGameTrophySetIds({
      selectedDiscPath: selected,
      discs: [{ path: eboot }, { path: selected }] as never,
    }),
    ["NPWR12345_00", "NPWR99999_00"]
  );
});

it("distinguishes unreadable media from a readable folder without trophies", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-trophy-media-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await findGameTrophySetIds({ selectedDiscPath: root }), []);
  await assert.rejects(
    findGameTrophySetIds({
      selectedDiscPath: root,
      discs: [{ path: path.join(root, "offline-disc") }] as never,
    })
  );
  await assert.rejects(
    findGameTrophySetIds({ selectedDiscPath: path.join(root, "missing") })
  );
  const iso = path.join(root, "partial.iso");
  await fs.writeFile(iso, Buffer.alloc(12));
  await assert.rejects(findGameTrophySetIds({ selectedDiscPath: iso }));
  // A present but invalid directory must not be accepted as an empty catalogue.
  await fs.writeFile(path.join(root, "TROPDIR"), "incomplete replacement");
  await assert.rejects(findGameTrophySetIds({ selectedDiscPath: root }));
});
