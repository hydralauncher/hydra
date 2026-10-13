import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { setTimeout as sleep } from "node:timers/promises";
import type { TorBoxClient as TorBoxClientType } from "./torbox.ts";
import { buildTorBoxDownloadManifest } from "./torbox-files.ts";

function client({
  ready = true,
  duplicate = false,
  newTorrent = false,
  linkSuccess = true,
  timeoutReady = false,
} = {}) {
  const requests: {
    method: string;
    url: string;
    form?: FormData;
    signal?: AbortSignal;
    at?: number;
  }[] = [];
  const torrent = {
    id: 42,
    hash: "abc",
    name: "Game",
    download_finished: ready,
    download_present: ready,
    files: [{ id: 0, name: "Game/readme", size: 3 }],
  };
  let config: { timeout: number } | undefined;
  const instance = {
    get: async (url: string, options?: { signal?: AbortSignal }) => {
      requests.push({
        method: "GET",
        url,
        signal: options?.signal,
        at: Date.now(),
      });
      const query = new URL(url, "https://fixture.invalid").searchParams;
      if (url.startsWith("/torrents/requestdl"))
        return {
          data: {
            success: linkSuccess,
            data: linkSuccess ? "https://fixture.invalid/direct" : null,
          },
        };
      if (query.has("id"))
        return {
          data: {
            data: timeoutReady
              ? null
              : { ...torrent, download_finished: true, download_present: true },
          },
        };
      return {
        data: {
          data: newTorrent
            ? []
            : duplicate
              ? [
                  torrent,
                  {
                    ...torrent,
                    id: 43,
                    download_finished: true,
                    download_present: true,
                  },
                ]
              : [torrent],
        },
      };
    },
    post: async (url: string, form: FormData) => {
      requests.push({ method: "POST", url, form });
      return {
        status: 200,
        data: { success: true, data: { torrent_id: 42, name: "Game" } },
      };
    },
  };
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(
    fs.readFileSync(new URL("./torbox.ts", import.meta.url), "utf8"),
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
    require: (id: string) => {
      const dependencies: Record<string, unknown> = {
        "node:timers/promises": { setTimeout: sleep },
        axios: {
          create: (options: unknown) => {
            config = options as { timeout: number };
            return instance;
          },
        },
        "parse-torrent": async () => ({ infoHash: "ABC", name: "Game" }),
        "@main/constants": { appVersion: "test" },
        "@shared": {
          DownloadError: {
            InvalidMagnet: "invalid",
            TorBoxLinkUnavailable: "unavailable",
            TorrentFilesUnavailable: "files",
            TorBoxTorrentNotReady: "not-ready",
          },
        },
        "../logger": {
          logger: { log: () => undefined, error: () => undefined },
        },
        "./torbox-files": { buildTorBoxDownloadManifest },
      };
      assert.ok(id in dependencies);
      return dependencies[id];
    },
    FormData,
    URLSearchParams,
    setTimeout: (callback: () => void) => callback(),
  });
  const TorBoxClient = exports.TorBoxClient as typeof TorBoxClientType;
  TorBoxClient.authorize("test-token");
  return { TorBoxClient, requests, getConfig: () => config! };
}
it("requests file ID zero directly without generating a ZIP", async () => {
  const { TorBoxClient, requests } = client();
  await TorBoxClient.requestLink(42, 0);
  const q = new URL(requests[0].url, "https://fixture.invalid").searchParams;
  assert.equal(q.get("file_id"), "0");
  assert.equal(q.get("zip_link"), "false");
});
it("prefers a ready cached match over an older pending duplicate", async () => {
  const { TorBoxClient, requests } = client({ ready: false, duplicate: true });
  assert.equal(
    (await TorBoxClient.getDownloadFiles("magnet:test")).torrentId,
    43
  );
  assert.equal(requests.length, 1);
});
it("requests non-ZIP cached-only torrent creation for previews", async () => {
  const { TorBoxClient, requests } = client({ newTorrent: true });
  await TorBoxClient.getDownloadFiles("magnet:test", true);
  const creation = requests.find((r) => r.method === "POST")!;
  assert.equal(creation.form!.get("allow_zip"), "false");
  assert.equal(creation.form!.get("add_only_if_cached"), "true");
});
it("fails bounded readiness polling without starting a download", async () => {
  const { TorBoxClient, requests } = client({
    ready: false,
    timeoutReady: true,
  });
  await assert.rejects(
    () => TorBoxClient.getDownloadFiles("magnet:test"),
    /not-ready/
  );
  assert.equal(requests.length, 7);
  assert.ok(requests.every((r) => !r.url.includes("requestdl")));
});
it("rejects missing download links and bounds API request time", async () => {
  const { TorBoxClient, getConfig } = client({ linkSuccess: false });
  await assert.rejects(() => TorBoxClient.requestLink(42, 7), /unavailable/);
  assert.equal(getConfig().timeout, 20000);
});

it("spaces concurrent TorBox link requests within the API budget", async () => {
  const { TorBoxClient, requests } = client();
  const controller = new AbortController();
  await Promise.all(
    [0, 1, 2].map((id) => TorBoxClient.requestLink(42, id, controller.signal))
  );
  assert.equal(requests.length, 3);
  for (let index = 1; index < requests.length; index++)
    assert.ok(requests[index].at! - requests[index - 1].at! >= 240);
  assert.ok(requests.every((request) => request.signal === controller.signal));
});
it("aborted queued links never reach TorBox", async () => {
  const { TorBoxClient, requests } = client();
  await TorBoxClient.requestLink(42, 0);
  const controller = new AbortController();
  const queued = TorBoxClient.requestLink(42, 1, controller.signal);
  controller.abort();
  await assert.rejects(queued, { name: "AbortError" });
  await assert.rejects(TorBoxClient.requestLink(42, 2, controller.signal), {
    name: "AbortError",
  });
  assert.equal(requests.length, 1);
});
