import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as debridFiles from "./debrid-files.ts";
import * as links from "./real-debrid-links.ts";
import { getRealDebridFiles } from "./real-debrid-files.ts";
import { DownloadError } from "../../../shared/constants.ts";
import type { RealDebridTorrentInfo } from "../../../types/download.types.ts";
import type { RealDebridClient as ClientType } from "./real-debrid.ts";

type Info = RealDebridTorrentInfo;
const magnet = "magnet:?xt=urn:btih:abc";
function fixture(
  options: {
    packed?: boolean;
    singles?: boolean;
    pending?: boolean;
    status?: Info["status"];
    noFiles?: boolean;
    badLinks?: boolean;
    noMatches?: boolean;
    delayedSelection?: boolean;
    staleCandidate?: boolean;
    deletedMain?: boolean;
    deletedAll?: boolean;
    packSelections?: boolean;
    stalePartialSelection?: boolean;
    omitUnselectedFiles?: boolean;
  } = {}
) {
  const manifestFiles = [
    { id: 1, path: "/dir/first.bin", bytes: 3, selected: 1 },
    { id: 2, path: "/dir/second.bin", bytes: 5, selected: 1 },
  ];
  const main = {
    id: "main",
    hash: "abc",
    filename: "Game",
    original_filename: "Game",
    status: options.status ?? "downloaded",
    ended: options.badLinks ? "invalid" : "2020-01-01T00:00:00Z",
    files: options.noFiles ? [] : structuredClone(manifestFiles),
    links:
      options.packed || options.badLinks ? ["packed"] : ["file-1", "file-2"],
  } as Info;
  const infos = new Map<string, Info>([["main", main]]);
  if (options.singles)
    for (const id of [1, 2])
      infos.set(`single-${id}`, {
        ...main,
        id: `single-${id}`,
        files: main.files.map((f) => ({ ...f, selected: Number(f.id === id) })),
        links: [`file-${id}`],
      });
  const requests: {
    method: string;
    url: string;
    files?: string;
    params?: unknown;
  }[] = [];
  let created = 0;
  let delayedInfo = false;
  let config: { timeout: number };
  let unlocked = {
    filename:
      options.packed || options.packSelections ? "folder.zip" : "first.bin",
    filesize: options.packed || options.packSelections ? 7 : 3,
    download:
      options.packed || options.packSelections
        ? "https://fixture.invalid/folder.zip"
        : "https://fixture.invalid/first.bin",
    chunks: 8,
  };
  const instance = {
    get: async (
      url: string,
      opts?: { signal?: AbortSignal; params?: unknown }
    ) => {
      opts?.signal?.throwIfAborted();
      requests.push({ method: "GET", url, params: opts?.params });
      if (url === "/torrents")
        return {
          data: options.noMatches
            ? []
            : [
                main,
                ...(options.staleCandidate ? [{ ...main, id: "deleted" }] : []),
                ...[...infos.values()].filter((info) => info.id !== "main"),
              ],
        };
      const info = infos.get(url.split("/").at(-1)!);
      if (
        !info ||
        options.deletedAll ||
        (options.deletedMain && info.id === "main")
      )
        throw { isAxiosError: true, response: { status: 404 } };
      if (delayedInfo) {
        delayedInfo = false;
        return {
          data: {
            ...structuredClone(info),
            status: options.stalePartialSelection
              ? "downloaded"
              : "waiting_files_selection",
            files: info.files
              .filter((file) => !options.omitUnselectedFiles || file.id === 1)
              .map((f) => ({
                ...f,
                selected: options.stalePartialSelection
                  ? Number(f.id === 1)
                  : 0,
              })),
            links: options.stalePartialSelection ? ["file-1"] : info.links,
          },
        };
      }
      return { data: structuredClone(info) };
    },
    post: async (
      url: string,
      form: string,
      opts?: { signal?: AbortSignal }
    ) => {
      opts?.signal?.throwIfAborted();
      const params = new URLSearchParams(form);
      requests.push({
        method: "POST",
        url,
        files: params.get("files") ?? undefined,
      });
      if (url === "/torrents/addMagnet") {
        const id = `created-${++created}`;
        infos.set(id, {
          ...main,
          id,
          status: "waiting_files_selection",
          files: main.files.map((f) => ({ ...f, selected: 0 })),
          links: [],
        });
        return { data: { id } };
      }
      if (url.startsWith("/torrents/selectFiles/")) {
        const info = infos.get(url.split("/").at(-1)!)!;
        if (!info.files?.length) info.files = structuredClone(manifestFiles);
        const selected = new Set(
          params.get("files") === "all"
            ? info.files.map((file) => file.id)
            : params.get("files")!.split(",").map(Number)
        );
        info.files = info.files.map((f) => ({
          ...f,
          selected: Number(selected.has(f.id)),
        }));
        info.status = options.pending ? "downloading" : "downloaded";
        info.links = options.pending
          ? []
          : options.packSelections &&
              info.files.filter((file) => file.selected).length > 1
            ? ["packed"]
            : info.files.filter((f) => f.selected).map((f) => `file-${f.id}`);
        delayedInfo = Boolean(
          options.delayedSelection || options.stalePartialSelection
        );
        return { data: null };
      }
      if (url === "/unrestrict/link") return { data: unlocked };
      throw new Error(`Unexpected request ${url}`);
    },
  };
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(
    fs.readFileSync(new URL("./real-debrid.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  runInNewContext(code, {
    exports,
    URLSearchParams,
    AbortSignal,
    require: (id: string) => {
      const deps: Record<string, unknown> = {
        axios: {
          create: (opts: unknown) => {
            config = opts as typeof config;
            return instance;
          },
          isAxiosError: (e: { isAxiosError?: boolean }) =>
            e.isAxiosError === true,
        },
        "node:https": { Agent: class {} },
        "node:timers/promises": {
          setTimeout: async (
            _ms: number,
            _value: unknown,
            opts?: { signal?: AbortSignal }
          ) => opts?.signal?.throwIfAborted(),
        },
        "parse-torrent": async () => ({ infoHash: "abc" }),
        "../../../shared/constants.js": { DownloadError },
        "./debrid-files.js": debridFiles,
        "./real-debrid-links.js": {
          ...links,
          waitForRealDebridLinks: (
            get: () => Promise<Info>,
            _wait: unknown,
            initial: Info,
            signal?: AbortSignal,
            allowArchive = false
          ) =>
            links.waitForRealDebridLinks(
              get,
              async () => {},
              initial,
              signal,
              allowArchive
            ),
        },
        "./real-debrid-files.js": { getRealDebridFiles },
      };
      assert.ok(id in deps, id);
      return deps[id];
    },
  });
  const client = exports.RealDebridClient as typeof ClientType;
  client.authorize("fixture-token");
  return {
    client,
    requests,
    infos,
    main,
    config: () => config,
    changeUnlock: (u: typeof unlocked) => {
      unlocked = u;
    },
  };
}
it("previews normalized paths without changing provider selection", async () => {
  const f = fixture();
  const preview = await f.client.getDownloadFiles(magnet);
  assert.equal(preview.files[0].path, "Game/dir/first.bin");
  assert.equal(preview.totalSize, 8);
  assert.ok(f.requests.every((r) => r.method === "GET"));
});
it("returns matching individual links without generating a packed link", async () => {
  const f = fixture();
  const result = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.deepEqual(
    Array.from(result.entries ?? [], (e) => e.url),
    ["file-1", "file-2"]
  );
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 0);
});
it("uses the provider archive without looking up existing single-file torrents", async () => {
  const f = fixture({ packed: true, singles: true });
  const result = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.equal(result.entries?.length, 1);
  assert.equal(result.entries?.[0].isArchive, true);
  assert.equal(result.entries?.[0].url, "packed");
  assert.equal(result.entries?.[0].resourceId, "realDebrid:abc:archive:1,2");
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/addMagnet").length,
    0
  );
  assert.ok(!f.requests.some((r) => r.url.includes("/info/single-")));
});
it("selects only the requested subset on one torrent when the existing archive includes other files", async () => {
  const f = fixture({ packed: true, singles: true });
  const result = await f.client.getDownloadEntriesWithTorrent(magnet, [2]);
  assert.equal(result.entries?.length, 1);
  assert.equal(result.entries?.[0].index, 2);
  assert.equal(result.entries?.[0].url, "file-2");
  assert.deepEqual(
    f.requests.filter((r) => r.files).map((r) => r.files),
    ["2"]
  );
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/addMagnet").length,
    1
  );
  assert.ok(!f.requests.some((r) => r.url === "/unrestrict/link"));
});
it("does not split an archive into cloud jobs on repeated preparation", async () => {
  const f = fixture({ packed: true });
  for (let poll = 0; poll < 3; poll++) {
    const result = await f.client.getDownloadEntriesWithTorrent(
      magnet,
      undefined,
      "main"
    );
    assert.equal(result.torrentId, "main");
    assert.equal(result.entries?.length, 1);
  }
  assert.ok(
    !f.requests.some((r) => r.url === "/torrents/addMagnet" || r.files)
  );
});
it("waits for the complete parent torrent to cache before resolving its archive", async () => {
  const f = fixture({ packed: true, status: "downloading", pending: true });
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries,
    null
  );
  assert.ok(!f.requests.some((r) => r.method === "POST"));
  f.main.status = "downloaded";
  const result = await f.client.getDownloadEntriesWithTorrent(
    magnet,
    undefined,
    "main"
  );
  assert.equal(result.entries?.length, 1);
  assert.ok(
    !f.requests.some((r) => r.url === "/torrents/addMagnet" || r.files)
  );
});
it("reuses the parent archive after reauthorizing the client", async () => {
  const f = fixture({ packed: true, singles: true });
  const first = await f.client.getDownloadEntriesWithTorrent(magnet);
  f.client.authorize("fixture-token");
  const second = await f.client.getDownloadEntriesWithTorrent(
    magnet,
    undefined,
    first.torrentId!
  );
  assert.equal(second.entries?.length, 1);
  assert.equal(second.entries?.[0].resourceId, first.entries?.[0].resourceId);
  assert.ok(
    !f.requests.some((r) => r.url === "/torrents/addMagnet" || r.files)
  );
});
it("a deleted old per-file torrent cannot trigger a new caching job for the parent archive", async () => {
  const f = fixture({ packed: true, singles: true });
  f.infos.delete("single-2");
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries?.length,
    1
  );
  assert.ok(
    !f.requests.some((r) => r.url === "/torrents/addMagnet" || r.files)
  );
});
it("recovers a deleted preferred torrent ID", async () => {
  const f = fixture();
  const result = await f.client.getDownloadEntriesWithTorrent(
    magnet,
    undefined,
    "deleted"
  );
  assert.equal(result.torrentId, "main");
  assert.equal(result.entries?.length, 2);
});
it("prefers a ready torrent over a pending duplicate", async () => {
  const f = fixture();
  f.infos.clear();
  f.infos.set("pending", { ...f.main, id: "pending", status: "downloading" });
  f.infos.set("main", f.main);
  assert.equal(await f.client.getTorrentId(magnet), "main");
});
for (const indices of [[], [99], [1.5]])
  it(`rejects invalid selection ${JSON.stringify(indices)} before mutations`, async () => {
    const f = fixture();
    await assert.rejects(
      () => f.client.getDownloadEntriesWithTorrent(magnet, indices),
      /selected debrid files/
    );
    assert.ok(f.requests.every((r) => r.method === "GET"));
  });
for (const status of ["error", "dead", "virus", "magnet_error"] as const)
  it(`rejects failed preferred torrents: ${status}`, async () => {
    const f = fixture({ status });
    await assert.rejects(
      () => f.client.getDownloadEntriesWithTorrent(magnet, undefined, "main"),
      /torrent failed/
    );
  });
it("bounds missing-file readiness polling", async () => {
  const f = fixture({ noFiles: true });
  await assert.rejects(
    () => f.client.getDownloadFiles(magnet),
    /real_debrid_torrent_not_ready/
  );
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/info/main").length,
    15
  );
});
it("bounds mismatched link polling instead of downloading the wrong file", async () => {
  const f = fixture({ badLinks: true });
  await assert.rejects(
    () => f.client.getDownloadEntriesWithTorrent(magnet),
    /real_debrid_links_not_ready/
  );
  assert.ok(f.requests.filter((r) => r.url.includes("/info/")).length <= 11);
});
it("honors abort before any account requests", async () => {
  const f = fixture();
  await assert.rejects(
    () =>
      f.client.getDownloadEntriesWithTorrent(
        magnet,
        undefined,
        undefined,
        AbortSignal.abort()
      ),
    /aborted/
  );
  assert.equal(f.requests.length, 0);
});
it("uses an API timeout and requests the supported larger torrent page", async () => {
  const f = fixture();
  await f.client.getTorrentId(magnet);
  assert.equal(f.config().timeout, 15000);
  assert.equal((f.requests[0].params as { limit: number }).limit, 5000);
});
it("checks filename and size before unlocking individual file links", async () => {
  const f = fixture();
  const unlocked = await f.client.unlockFileWithDetails(
    "file-1",
    "/dir/first.bin",
    3
  );
  assert.equal(unlocked.chunks, 8);
  await assert.rejects(
    () => f.client.unlockFile("file-1", "/dir/second.bin", 3),
    /different torrent file/
  );
  await assert.rejects(
    () => f.client.unlockFile("file-1", "/dir/first.bin", 99),
    /different torrent file/
  );
});
it("does not create or unlock links for zero-byte files", async () => {
  const f = fixture({ packed: true, singles: true });
  f.main.files[0].bytes = 0;
  const result = await f.client.getDownloadEntriesWithTorrent(magnet, [1]);
  assert.equal(result.entries?.[0].url, "about:blank");
  assert.ok(f.requests.every((r) => r.method === "GET"));
});
for (const [label, mutate] of [
  [
    "traversal",
    (i: Info) => {
      i.files[0].path = "/../escape";
    },
  ],
  [
    "UNC path",
    (i: Info) => {
      i.files[0].path = "//server/escape";
    },
  ],
  [
    "duplicate IDs",
    (i: Info) => {
      i.files[1].id = 1;
    },
  ],
  [
    "case collision",
    (i: Info) => {
      i.files[1].path = "/dir/FIRST.bin";
    },
  ],
  [
    "file directory collision",
    (i: Info) => {
      i.files[1].path = "/dir/first.bin/child";
    },
  ],
  [
    "negative size",
    (i: Info) => {
      i.files[0].bytes = -1;
    },
  ],
  [
    "size overflow",
    (i: Info) => {
      i.files[0].bytes = Number.MAX_SAFE_INTEGER;
    },
  ],
] as const)
  it(`rejects unsafe Real-Debrid metadata: ${label}`, () => {
    const f = fixture();
    mutate(f.main);
    assert.throws(() => getRealDebridFiles(f.main), /Real-Debrid/);
  });
it("normalizes Unicode and reserved local filenames while retaining the source name", () => {
  const f = fixture();
  f.main.files[0].path = "/e\u0301/CON.txt";
  const file = getRealDebridFiles(f.main)[0];
  assert.equal(file.path, "Game/é/_CON.txt");
  assert.equal(file.sourcePath, "/e\u0301/CON.txt");
});

it("waits for provider selection updates before resolving the whole archive", async () => {
  const f = fixture({
    status: "waiting_files_selection",
    packSelections: true,
    delayedSelection: true,
  });
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries,
    null
  );
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet, undefined, "main"))
      .entries?.length,
    1
  );
  assert.deepEqual(
    f.requests.filter((r) => r.files).map((r) => r.files),
    ["all"]
  );
});

it("preserves escaped filename and signature characters in download URLs", async () => {
  const f = fixture();
  const url = "https://fixture.invalid/first%23bin?signature=a%2Bb%26c";
  f.changeUnlock({
    filename: "first.bin",
    filesize: 3,
    download: url,
    chunks: 1,
  });
  assert.equal(
    (await f.client.unlockFileWithDetails("file-1", "/first.bin", 3)).url,
    url
  );
  assert.equal(
    (await f.client.getDownloadEntries("https://fixture.invalid/locked"))?.[0]
      .url,
    url
  );
});
it("does not inspect unrelated deleted torrents when resolving a ready archive", async () => {
  const f = fixture({ packed: true, singles: true, staleCandidate: true });
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries?.length,
    1
  );
  assert.ok(!f.requests.some((r) => r.url === "/torrents/info/deleted"));
});

it("excludes stale listed IDs when recovering a deleted main torrent", async () => {
  const f = fixture({ deletedMain: true });
  const preview = await f.client.getDownloadFiles(magnet);
  assert.equal(preview.files.length, 2);
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/info/main").length,
    1
  );
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/addMagnet").length,
    1
  );
});
it("bounds recovery when every newly returned torrent ID is unavailable", async () => {
  const f = fixture({ deletedAll: true });
  await assert.rejects(
    () => f.client.getDownloadFiles(magnet),
    /real_debrid_torrent_not_ready/
  );
  assert.equal(f.requests.filter((r) => r.url.includes("/info/")).length, 15);
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/addMagnet").length,
    14
  );
});

it("whole download selects all on a waiting torrent before file metadata is available", async () => {
  const f = fixture({
    status: "waiting_files_selection",
    noFiles: true,
    pending: true,
  });
  const result = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.equal(result.torrentId, "main");
  assert.equal(result.entries, null);
  assert.deepEqual(
    f.requests
      .filter((request) => request.files)
      .map((request) => request.files),
    ["all"]
  );
  assert.equal(f.main.status, "downloading");
  assert.equal(f.main.files.filter((file) => file.selected).length, 2);
  assert.equal(
    f.requests.filter((request) => request.url === "/torrents/addMagnet")
      .length,
    0
  );
});

it("whole download starts one full selection instead of accepting an actively caching subset", async () => {
  const f = fixture({ status: "downloading", pending: true });
  f.main.files[1].selected = 0;
  f.main.links = [];
  const first = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.equal(first.entries, null);
  assert.notEqual(first.torrentId, "main");
  const selected = f.infos.get(first.torrentId!)!;
  assert.equal(selected.files.filter((file) => file.selected).length, 2);
  await f.client.getDownloadEntriesWithTorrent(
    magnet,
    undefined,
    first.torrentId!
  );
  assert.equal(
    f.requests.filter((request) => request.url === "/torrents/addMagnet")
      .length,
    1
  );
  assert.deepEqual(
    f.requests
      .filter((request) => request.files)
      .map((request) => request.files),
    ["all"]
  );
  selected.status = "downloaded";
  selected.links = ["file-1", "file-2"];
  const ready = await f.client.getDownloadEntriesWithTorrent(
    magnet,
    undefined,
    first.torrentId!
  );
  assert.equal(ready.entries?.length, 2);
});

it("whole download handles a provider archive appearing immediately after selecting all without more cloud jobs", async () => {
  const f = fixture({
    status: "waiting_files_selection",
    packSelections: true,
  });
  f.main.files.forEach((file) => {
    file.selected = 0;
  });
  f.main.links = [];
  const result = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.equal(result.entries?.length, 1);
  assert.equal(result.entries?.[0].url, "packed");
  assert.deepEqual(
    f.requests.filter((r) => r.files).map((r) => r.files),
    ["all"]
  );
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/addMagnet").length,
    0
  );
});

it("selection metadata lag does not create replacement torrents on every readiness poll", async () => {
  const f = fixture({ status: "queued", pending: true });
  f.main.files.forEach((file) => {
    file.selected = 0;
  });
  f.main.links = [];
  for (let poll = 0; poll < 3; poll++) {
    const result = await f.client.getDownloadEntriesWithTorrent(
      magnet,
      [1, 2],
      "main"
    );
    assert.equal(result.torrentId, "main");
    assert.equal(result.entries, null);
  }
  assert.equal(
    f.requests.filter((request) => request.url === "/torrents/addMagnet")
      .length,
    0
  );
});

it("whole download retains the complete selection while caching and resumes readiness after client restart", async () => {
  const f = fixture({ status: "waiting_files_selection", pending: true });
  f.main.files.forEach((file) => {
    file.selected = 0;
  });
  f.main.links = [];
  const first = await f.client.getDownloadEntriesWithTorrent(magnet);
  f.client.authorize("fixture-token");
  const second = await f.client.getDownloadEntriesWithTorrent(
    magnet,
    undefined,
    first.torrentId!
  );
  assert.equal(second.entries, null);
  assert.equal(second.torrentId, "main");
  assert.deepEqual(
    f.requests
      .filter((request) => request.files)
      .map((request) => request.files),
    ["all"]
  );
  f.main.status = "downloaded";
  f.main.links = ["file-1", "file-2"];
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet, undefined, "main"))
      .entries?.length,
    2
  );
});

it("whole download selects all when the provider omits the waiting torrent's file list", async () => {
  const f = fixture({
    status: "waiting_files_selection",
    noFiles: true,
    pending: true,
  });
  delete (f.main as Partial<Info>).files;
  const result = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.equal(result.torrentId, "main");
  assert.equal(result.entries, null);
  assert.deepEqual(
    f.requests
      .filter((request) => request.files)
      .map((request) => request.files),
    ["all"]
  );
});

it("whole download waits for all selected files instead of returning a stale ready subset", async () => {
  const f = fixture({
    status: "waiting_files_selection",
    stalePartialSelection: true,
  });
  f.main.files.forEach((file) => {
    file.selected = 0;
  });
  f.main.links = [];
  const first = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.equal(first.entries, null);
  assert.equal(first.torrentId, "main");
  const second = await f.client.getDownloadEntriesWithTorrent(
    magnet,
    undefined,
    "main"
  );
  assert.equal(second.entries?.length, 2);
  assert.equal(
    f.requests.filter((request) => request.url === "/torrents/addMagnet")
      .length,
    0
  );
});

it("whole download checks readiness against the original requested file IDs", async () => {
  const f = fixture({
    status: "waiting_files_selection",
    stalePartialSelection: true,
    omitUnselectedFiles: true,
  });
  f.main.files.forEach((file) => {
    file.selected = 0;
  });
  f.main.links = [];
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries,
    null
  );
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet, undefined, "main"))
      .entries?.length,
    2
  );
});

it("whole packed downloads keep one provider torrent instead of caching each file", async () => {
  const f = fixture({ packed: true });
  f.changeUnlock({
    filename: "folder.zip",
    filesize: 7,
    download: "https://fixture.invalid/folder.zip",
    chunks: 1,
  });
  const result = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.equal(result.torrentId, "main");
  assert.equal(result.entries?.length, 1);
  assert.equal(result.entries?.[0].url, "packed");
  assert.equal(result.entries?.[0].path, "folder.zip");
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/addMagnet").length,
    0
  );
  assert.equal(f.requests.filter((r) => r.files).length, 0);
});

for (const filename of ["folder.zip", "folder.rar", "folder.7z"]) {
  it(`accepts the provider's ${filename.split(".").at(-1)} archive with its actual compressed size`, async () => {
    const f = fixture({ packed: true });
    f.changeUnlock({
      filename,
      filesize: 7,
      download: "https://fixture.invalid/archive",
      chunks: 1,
    });
    const entry = (await f.client.getDownloadEntriesWithTorrent(magnet))
      .entries?.[0];
    assert.equal(entry?.path, filename);
    assert.equal(entry?.size, 7);
    assert.equal(entry?.isArchive, true);
    assert.ok(
      !f.requests.some((r) => r.url === "/torrents/addMagnet" || r.files)
    );
  });
}
for (const filename of [
  "wrong.bin",
  "../escape.zip",
  "/escape.zip",
  "C:\\escape.zip",
]) {
  it(`rejects an invalid archive name ${filename}`, async () => {
    const f = fixture({ packed: true });
    f.changeUnlock({
      filename,
      filesize: 7,
      download: "https://fixture.invalid/archive",
      chunks: 1,
    });
    await assert.rejects(
      () => f.client.getDownloadEntriesWithTorrent(magnet),
      /Real-Debrid/
    );
    assert.ok(
      !f.requests.some((r) => r.url === "/torrents/addMagnet" || r.files)
    );
  });
}
it("keeps different archive selections separate in saved range metadata", async () => {
  const f = fixture({ packed: true, packSelections: true });
  const full = (await f.client.getDownloadEntriesWithTorrent(magnet))
    .entries?.[0];
  f.main.files.push({ id: 3, path: "/dir/third.bin", bytes: 2, selected: 1 });
  const larger = (
    await f.client.getDownloadEntriesWithTorrent(magnet, [3, 2, 1])
  ).entries?.[0];
  assert.notEqual(full?.resourceId, larger?.resourceId);
  assert.equal(larger?.resourceId, "realDebrid:abc:archive:1,2,3");
});
it("accepts an archive whose size is unknown without declaring it an empty file", async () => {
  const f = fixture({ packed: true });
  f.changeUnlock({
    filename: "folder.zip",
    filesize: 0,
    download: "https://fixture.invalid/archive",
    chunks: 1,
  });
  const entry = (await f.client.getDownloadEntriesWithTorrent(magnet))
    .entries?.[0];
  assert.equal(entry?.size, 0);
  assert.equal(entry?.isArchive, true);
  assert.equal(entry?.url, "packed");
});

it("legacy URL resolution returns the parent archive without creating individual torrents", async () => {
  const f = fixture({ packed: true });
  assert.equal(
    await f.client.getDownloadUrl(magnet),
    "https://fixture.invalid/folder.zip"
  );
  assert.ok(
    !f.requests.some((r) => r.url === "/torrents/addMagnet" || r.files)
  );
});
