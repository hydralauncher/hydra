import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  EpicLinuxProtonPathDecoder,
  epicLinuxPrefixKey,
  epicLinuxPrerequisiteIdentity,
  parseEpicLinuxMappedPath,
  parseEpicPrerequisiteResult,
} from "./linux-runtime-protocol.js";

test("bootstrap accepts only the final absolute PROTONPATH assignment across chunks/ANSI", () => {
  const decoder = new EpicLinuxProtonPathDecoder();
  decoder.push("DEBUG: PROTONPATH=UMU-Proton\nDEBUG: PROTON");
  decoder.push(
    "PATH=/home/user/old\n\u001b[34mDEBUG\u001b[0m: PROTONPATH=/home/user/Proton with spaces\n"
  );
  decoder.push("DEBUG: ('/home/user/old/proton', 'run', 'private')\n");
  assert.equal(decoder.finish(), "/home/user/Proton with spaces");
  assert.equal(new EpicLinuxProtonPathDecoder().finish(), null);
  assert.throws(() =>
    new EpicLinuxProtonPathDecoder().push("x".repeat(70_000))
  );
});

test("default prefix identity separates owner, account and artifact", () => {
  const owner = {
    environment: "production",
    userId: "user",
    epicAccountId: "account",
  };
  const first = epicLinuxPrefixKey(owner, "Artifact");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, epicLinuxPrefixKey({ ...owner }, "Artifact"));
  for (const other of [
    { ...owner, userId: "other" },
    { ...owner, epicAccountId: "other" },
    { ...owner, environment: "staging" },
  ])
    assert.notEqual(first, epicLinuxPrefixKey(other, "Artifact"));
  assert.notEqual(first, epicLinuxPrefixKey(owner, "Other"));
});

test("prerequisite result requires nonce/schema and preserves complete DWORD codes", () => {
  for (const exitCode of [0, 3010, 1641, 194, 105, 0xffff_ffff])
    assert.equal(
      parseEpicPrerequisiteResult(
        { schemaVersion: 1, nonce: "expected", exitCode },
        "expected"
      ),
      exitCode
    );
  for (const value of [
    null,
    { nonce: "expected", exitCode: 0 },
    { schemaVersion: 1, nonce: "other", exitCode: 0 },
    { schemaVersion: 1, nonce: "expected", exitCode: -1 },
    { schemaVersion: 1, nonce: "expected", exitCode: 0x1_0000_0000 },
  ])
    assert.throws(() => parseEpicPrerequisiteResult(value, "expected"));
});

test("receipt identity changes when runtime, generation, build, installer or argv changes", () => {
  const identity = epicLinuxPrerequisiteIdentity(
    "build",
    "sha",
    ["/quiet"],
    "prefix",
    "proton"
  );
  for (const changed of [
    epicLinuxPrerequisiteIdentity(
      "next",
      "sha",
      ["/quiet"],
      "prefix",
      "proton"
    ),
    epicLinuxPrerequisiteIdentity(
      "build",
      "other",
      ["/quiet"],
      "prefix",
      "proton"
    ),
    epicLinuxPrerequisiteIdentity("build", "sha", [], "prefix", "proton"),
    epicLinuxPrerequisiteIdentity("build", "sha", ["/quiet"], "new", "proton"),
    epicLinuxPrerequisiteIdentity("build", "sha", ["/quiet"], "prefix", "new"),
  ])
    assert.notEqual(identity, changed);
});

test("path protocol rejects mixed diagnostics, relative paths and malformed output", () => {
  assert.equal(
    parseEpicLinuxMappedPath("X:\\Games\\Space Name\r\n", true),
    "X:\\Games\\Space Name"
  );
  assert.equal(
    parseEpicLinuxMappedPath("/mnt/Games/Space Name\n", false),
    "/mnt/Games/Space Name"
  );
  for (const output of [
    "",
    "relative",
    "DEBUG: hello\nX:\\Games\n",
    "X:\\Games\0",
  ])
    assert.throws(() => parseEpicLinuxMappedPath(output, true));
});

const { generateMap } = createRequire(import.meta.url)(
  "../../../../scripts/update-epic-umu-map.cjs"
);
test("UMU snapshot import matches Epic codenames, normalizes upstream keys and rejects collisions", () => {
  const commit = "a".repeat(40);
  const map = generateMap(
    'TITLE,STORE,CODENAME,UMU_ID\n"Name, with comma",egs,Catnip,umu-397540\nOther,gog,Catnip,umu-other\n',
    commit
  );
  assert.deepEqual(map.entries, { catnip: "umu-397540" });
  assert.equal(map.commit, commit);
  assert.match(map.csvSha256, /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      generateMap(
        "TITLE,STORE,CODENAME,UMU_ID\nOne,egs,A,umu-one\nTwo,egs,a,umu-two",
        commit
      ),
    /Conflicting/
  );
});
