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
  } = {}
) {
  const main = {
    id: "main",
    hash: "abc",
    filename: "Game",
    original_filename: "Game",
    status: options.status ?? "downloaded",
    ended: options.badLinks ? "invalid" : "2020-01-01T00:00:00Z",
    files: options.noFiles
      ? []
      : [
          { id: 1, path: "/dir/first.bin", bytes: 3, selected: 1 },
          { id: 2, path: "/dir/second.bin", bytes: 5, selected: 1 },
        ],
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
    filename: "first.bin",
    filesize: 3,
    download: "https://fixture.invalid/first.bin",
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
            status: "waiting_files_selection",
            files: info.files.map((f) => ({ ...f, selected: 0 })),
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
        const selected = new Set(params.get("files")!.split(",").map(Number));
        info.files = info.files.map((f) => ({
          ...f,
          selected: Number(selected.has(f.id)),
        }));
        info.status = options.pending ? "downloading" : "downloaded";
        info.links = options.pending
          ? []
          : info.files.filter((f) => f.selected).map((f) => `file-${f.id}`);
        delayedInfo = Boolean(options.delayedSelection);
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
            signal?: AbortSignal
          ) =>
            links.waitForRealDebridLinks(get, async () => {}, initial, signal),
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
it("reuses existing single-file torrents for a provider-packed folder", async () => {
  const f = fixture({ packed: true, singles: true });
  const result = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.deepEqual(
    Array.from(result.entries ?? [], (e) => e.url),
    ["file-1", "file-2"]
  );
  assert.ok(f.requests.every((r) => r.method === "GET"));
});
it("resolves only the selected file in a provider-packed folder", async () => {
  const f = fixture({ packed: true, singles: true });
  const result = await f.client.getDownloadEntriesWithTorrent(magnet, [2]);
  assert.equal(result.entries?.length, 1);
  assert.equal(result.entries?.[0].index, 2);
  assert.equal(result.entries?.[0].url, "file-2");
});
it("creates one selection per file and never unlocks the provider archive", async () => {
  const f = fixture({ packed: true });
  const result = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.equal(result.entries?.length, 2);
  assert.deepEqual(
    f.requests.filter((r) => r.files).map((r) => r.files),
    ["1", "2"]
  );
  assert.ok(!f.requests.some((r) => r.url === "/unrestrict/link"));
});
it("keeps pending individual torrents and reuses them on the next preparation", async () => {
  const f = fixture({ packed: true, pending: true });
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries,
    null
  );
  for (const [id, info] of f.infos)
    if (id.startsWith("created")) {
      info.status = "downloaded";
      info.links = info.files
        .filter((x) => x.selected)
        .map((x) => `file-${x.id}`);
    }
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries?.length,
    2
  );
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/addMagnet").length,
    2
  );
});
it("reuses single-file torrents after reauthorizing the client", async () => {
  const f = fixture({ packed: true, singles: true });
  await f.client.getDownloadEntriesWithTorrent(magnet);
  f.client.authorize("fixture-token");
  await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.ok(f.requests.every((r) => r.method === "GET"));
});
it("recovers a deleted per-file torrent without replaying other selections", async () => {
  const f = fixture({ packed: true, singles: true });
  await f.client.getDownloadEntriesWithTorrent(magnet);
  f.infos.delete("single-2");
  const result = await f.client.getDownloadEntriesWithTorrent(magnet);
  assert.equal(result.entries?.length, 2);
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/addMagnet").length,
    1
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

it("waits for provider selection updates instead of failing immediately", async () => {
  const f = fixture({ packed: true, delayedSelection: true });
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries,
    null
  );
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries?.length,
    2
  );
  assert.equal(
    f.requests.filter((r) => r.url === "/torrents/addMagnet").length,
    2
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
it("ignores a torrent deleted between the list and individual-file lookup", async () => {
  const f = fixture({ packed: true, singles: true, staleCandidate: true });
  assert.equal(
    (await f.client.getDownloadEntriesWithTorrent(magnet)).entries?.length,
    2
  );
  assert.ok(f.requests.some((r) => r.url === "/torrents/info/deleted"));
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
