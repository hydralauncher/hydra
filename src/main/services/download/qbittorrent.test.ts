import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import type { QbittorrentServer } from "@types";
import { QbittorrentClient } from "./qbittorrent.ts";

const server: QbittorrentServer = {
  id: "home",
  name: "Home",
  url: "https://torrent.example.test/qbt/",
  username: "hydra",
  password: "secret",
  defaultSavePath: "/downloads/games",
};

const authenticatedResponse = () =>
  new Response("Ok.", {
    status: 200,
    headers: { "Set-Cookie": "SID=session-id; HttpOnly; path=/" },
  });

afterEach(() => mock.restoreAll());

describe("QbittorrentClient", () => {
  it("authenticates and supports WebUI URLs under a reverse-proxy path", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mock.method(globalThis, "fetch", async (input, init) => {
      const url = String(input);
      requests.push({ url, init });

      if (url.endsWith("/auth/login")) return authenticatedResponse();
      return new Response("v5.2.1", { status: 200 });
    });

    const version = await new QbittorrentClient(server).getVersion();

    assert.equal(version, "v5.2.1");
    assert.equal(
      requests[0].url,
      "https://torrent.example.test/qbt/api/v2/auth/login"
    );
    assert.equal(
      requests[1].url,
      "https://torrent.example.test/qbt/api/v2/app/version"
    );
    assert.equal(
      new Headers(requests[1].init?.headers).get("cookie"),
      "SID=session-id"
    );
  });

  it("reports rejected credentials", async () => {
    mock.method(
      globalThis,
      "fetch",
      async () => new Response("Fails.", { status: 200 })
    );

    await assert.rejects(
      () => new QbittorrentClient(server).getVersion(),
      /authentication failed/
    );
  });

  it("supports WebUI authentication bypass without a session cookie", async () => {
    let requestCount = 0;
    mock.method(globalThis, "fetch", async (input) => {
      requestCount += 1;
      if (String(input).endsWith("/auth/login")) {
        return new Response("Ok.", { status: 200 });
      }
      return new Response("v5.2.1", { status: 200 });
    });

    const client = new QbittorrentClient({
      ...server,
      username: "",
      password: "",
    });
    await client.getVersion();
    await client.getVersion();

    assert.equal(requestCount, 3);
  });

  it("adds a selective download without resuming a superseded start", async () => {
    let infoRequestCount = 0;
    let addForm: FormData | null = null;
    const priorityBodies: URLSearchParams[] = [];
    const requestedPaths: string[] = [];

    mock.method(globalThis, "fetch", async (input, init) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);

      if (url.pathname.endsWith("/auth/login")) {
        return authenticatedResponse();
      }
      if (url.pathname.endsWith("/torrents/info")) {
        infoRequestCount += 1;
        return Response.json(
          infoRequestCount === 1
            ? []
            : [
                {
                  hash: "abc123",
                  name: "Game",
                  progress: 0,
                  downloaded: 0,
                  size: 10,
                  dlspeed: 0,
                  upspeed: 0,
                  num_leechs: 0,
                  num_seeds: 0,
                  eta: 0,
                  state: "stoppedDL",
                  save_path: "/downloads/games",
                  content_path: "/downloads/games/Game",
                },
              ]
        );
      }
      if (url.pathname.endsWith("/torrents/add")) {
        addForm = init?.body as FormData;
        return new Response("Ok.", { status: 200 });
      }
      if (url.pathname.endsWith("/torrents/files")) {
        return Response.json([
          { index: 0, name: "one.bin", size: 1, priority: 1, progress: 0 },
          { index: 1, name: "two.bin", size: 2, priority: 1, progress: 0 },
          { index: 2, name: "three.bin", size: 3, priority: 1, progress: 0 },
        ]);
      }
      if (url.pathname.endsWith("/torrents/filePrio")) {
        priorityBodies.push(init?.body as URLSearchParams);
        return new Response("", { status: 200 });
      }

      throw new Error(`Unexpected qBittorrent request: ${url.pathname}`);
    });

    await new QbittorrentClient(server).addTorrent({
      magnetUri: "magnet:?xt=urn:btih:abc123",
      infoHash: "abc123",
      savePath: "/downloads/games",
      fileIndices: [1],
      canResume: () => false,
    });

    const submittedForm = addForm as FormData | null;
    assert.ok(submittedForm);
    assert.equal(submittedForm.get("urls"), "magnet:?xt=urn:btih:abc123");
    assert.equal(submittedForm.get("savepath"), "/downloads/games");
    assert.equal(submittedForm.get("stopped"), "true");
    assert.deepEqual(
      priorityBodies.map((body) => Object.fromEntries(body)),
      [
        { hash: "abc123", id: "0|2", priority: "0" },
        { hash: "abc123", id: "1", priority: "1" },
      ]
    );
    assert.equal(
      requestedPaths.some((path) => path.endsWith("/torrents/start")),
      false
    );
  });

  it("falls back to the qBittorrent 4 pause endpoint", async () => {
    const requestedPaths: string[] = [];
    mock.method(globalThis, "fetch", async (input) => {
      const url = String(input);
      requestedPaths.push(new URL(url).pathname);

      if (url.endsWith("/auth/login")) return authenticatedResponse();
      if (url.endsWith("/torrents/stop")) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response("", { status: 200 });
    });

    await new QbittorrentClient(server).pauseTorrent("abc123");

    assert.deepEqual(requestedPaths.slice(-2), [
      "/qbt/api/v2/torrents/stop",
      "/qbt/api/v2/torrents/pause",
    ]);
  });
});
