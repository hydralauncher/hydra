import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test, { type TestContext } from "node:test";
import {
  prepareEpicOwnershipToken,
  disposeEpicOwnershipTokenIfStopped,
} from "./ownership-token.js";

async function fixture(t: TestContext) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "epic-ownership-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const file = path.join(workspace, "tmp", "NamespaceItem.ovt");
  const parameters = (args: string[]) => ({
    executable: "/game/Game.exe",
    workingDirectory: "/game",
    environment: {},
    args,
  });
  return { workspace, file, parameters };
}

test("ownership directory is mapped before Legendary writes the fresh token; translation retains auth args and cleanup owns only token", async (t) => {
  const f = await fixture(t);
  let maps = 0;
  const token = await prepareEpicOwnershipToken(
    f.workspace,
    "Namespace:Item",
    true,
    async (directory) => {
      maps++;
      assert.equal(directory, path.dirname(f.file));
      await assert.rejects(fs.stat(f.file), { code: "ENOENT" });
      return "Q:\\Private Space";
    }
  );
  assert.equal(maps, 1);
  await fs.writeFile(f.file, "synthetic ownership bytes");
  const unrelated = path.join(path.dirname(f.file), "unrelated.txt");
  await fs.writeFile(unrelated, "retain");
  const translated = await token.translate(
    f.parameters([
      "-AUTH_PASSWORD=synthetic code",
      `-epicovt=${f.file}`,
      "-EpicPortal",
    ])
  );
  assert.deepEqual(translated.args, [
    "-AUTH_PASSWORD=synthetic code",
    "-epicovt=Q:\\Private Space\\NamespaceItem.ovt",
    "-EpicPortal",
  ]);
  await token.dispose();
  await assert.rejects(fs.stat(f.file), { code: "ENOENT" });
  assert.equal(await fs.readFile(unrelated, "utf8"), "retain");
});

test("ownership contract rejects missing/duplicate/unexpected token arguments and paths outside its workspace", async (t) => {
  const f = await fixture(t);
  const token = await prepareEpicOwnershipToken(
    f.workspace,
    "Namespace:Item",
    true,
    async () => "Q:\\Private"
  );
  await fs.writeFile(f.file, "fixture");
  for (const args of [
    [],
    [`-epicovt=${f.file}`, `-epicovt=${f.file}`],
    ["-epicovt=/outside/token.ovt"],
  ])
    await assert.rejects(token.translate(f.parameters(args)));
  const optional = await prepareEpicOwnershipToken(
    f.workspace,
    "Namespace:Item",
    false,
    async () => {
      throw new Error("must not map without token requirement");
    }
  );
  await assert.rejects(
    optional.translate(f.parameters([`-epicovt=${f.file}`])),
    /invalid-response/
  );
  const ordinary = f.parameters(["-EpicPortal"]);
  assert.equal(await optional.translate(ordinary), ordinary);
  await optional.dispose();
  assert.equal(await fs.readFile(f.file, "utf8"), "fixture");
});

test("ownership rejects hard-linked credentials before overwrite and after auth", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.file));
  const other = path.join(f.workspace, "other");
  await fs.writeFile(other, "do not overwrite");
  await fs.link(other, f.file);
  await assert.rejects(
    prepareEpicOwnershipToken(
      f.workspace,
      "Namespace:Item",
      true,
      async () => "Q:\\Private"
    ),
    /invalid-path/
  );
  assert.equal(await fs.readFile(other, "utf8"), "do not overwrite");
  await fs.unlink(f.file);
  const token = await prepareEpicOwnershipToken(
    f.workspace,
    "Namespace:Item",
    true,
    async () => "Q:\\Private"
  );
  await fs.link(other, f.file);
  await assert.rejects(
    token.translate(f.parameters([`-epicovt=${f.file}`])),
    /invalid-path/
  );
  assert.equal(await fs.readFile(other, "utf8"), "do not overwrite");
});

test("ownership rejects invalid object identity without creating a credential path", async (t) => {
  const f = await fixture(t);
  for (const id of [
    "../outside:Item",
    "Namespace:../Item",
    "Namespace:Item:Other",
    "Namespace:",
  ])
    await assert.rejects(
      prepareEpicOwnershipToken(
        f.workspace,
        id,
        true,
        async () => "Q:\\Private"
      ),
      /invalid-path/
    );
  await assert.rejects(fs.stat(path.dirname(f.file)), { code: "ENOENT" });
});

test("stopped-prefix reconciliation removes only its exact owned token and rejects linked files", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.file));
  await fs.writeFile(f.file, "stale credential");
  const other = path.join(path.dirname(f.file), "OtherItem.ovt");
  await fs.writeFile(other, "retain");
  assert.equal(
    await disposeEpicOwnershipTokenIfStopped(f.workspace, "Namespace:Item"),
    true
  );
  assert.equal(
    await disposeEpicOwnershipTokenIfStopped(f.workspace, "Namespace:Item"),
    false
  );
  assert.equal(await fs.readFile(other, "utf8"), "retain");
  await fs.link(other, f.file);
  await assert.rejects(
    disposeEpicOwnershipTokenIfStopped(f.workspace, "Namespace:Item"),
    /invalid-path/
  );
  assert.equal(await fs.readFile(other, "utf8"), "retain");
});
