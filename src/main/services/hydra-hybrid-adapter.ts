import axios, {
  type AxiosAdapter,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import {
  clearCustomArtwork,
  clearProfileAsset,
  deleteEmulationSave,
  deleteSaveArtifact,
  downloadEmulationSave,
  listEmulationSaves,
  listSaveArtifacts,
  renameSaveArtifact,
  updateEmulationSaveLabel,
  uploadCustomArtwork,
  uploadProfileAsset,
  upsertEmulationSave,
  type ArtworkKind,
} from "./drive/drive-storage.js";
import fs from "node:fs";
import path from "node:path";
import { SystemPath } from "./system-path.js";
import { logger } from "./logger.js";

// Hybrid axios adapter. Every hydra-api URL that used to hit Hydra Cloud's
// paid endpoints is intercepted here and served from local state + Google
// Drive instead. Everything else falls through to the real network adapter,
// so the catalogue, achievements catalog, library sync, and friends still
// go to Hydra's public API.
//
// Return shape mirrors what the corresponding Hydra endpoint would return so
// the renderer's Redux slices and hooks stay unchanged.

type Method = "get" | "post" | "put" | "delete" | "patch";

interface HybridHandler {
  method: Method;
  pattern: RegExp;
  handle: (
    match: RegExpMatchArray,
    config: AxiosRequestConfig
  ) => Promise<unknown>;
}

function ok<T>(data: T, config: AxiosRequestConfig, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: status === 204 ? "No Content" : "OK",
    headers: {},
    config: config as any,
    request: {},
  };
}

function parseBody(config: AxiosRequestConfig): any {
  if (!config.data) return {};
  if (typeof config.data === "string") {
    try { return JSON.parse(config.data); } catch { return {}; }
  }
  if (Buffer.isBuffer(config.data)) return {};
  return config.data;
}

function parseSearchParams(url: string | undefined): URLSearchParams {
  if (!url) return new URLSearchParams();
  const q = url.split("?")[1] ?? "";
  return new URLSearchParams(q);
}

function stripQuery(url: string | undefined): string {
  return (url ?? "").split("?")[0];
}

const handlers: HybridHandler[] = [
  // --- Save-game artifacts ---
  {
    method: "get",
    pattern: /^\/profile\/games\/artifacts$/,
    handle: async (_m, config) => {
      const params = parseSearchParams(config.url);
      const shop = params.get("shop") ?? "";
      const objectId = params.get("objectId") ?? "";
      if (!shop || !objectId) return [];
      const list = await listSaveArtifacts(shop, objectId);
      return list.map((a) => ({
        id: a.id,
        artifactLengthInBytes: a.sizeBytes,
        downloadOptionTitle: a.downloadOptionTitle,
        createdAt: a.createdAt,
        updatedAt: a.createdAt,
        hostname: a.hostname,
        downloadCount: 0,
        label: a.label,
        isFrozen: false,
      }));
    },
  },
  {
    method: "delete",
    pattern: /^\/profile\/games\/artifacts\/([^/]+)$/,
    handle: async (match) => {
      const artifactId = match[1];
      // We don't know the shop/objectId from the URL; scan the sublevels.
      // Since artifact IDs are UUIDs the search is bounded to metadata rows.
      const { db } = await import("@main/level");
      const iter = db.iterator<string, unknown>({ valueEncoding: "json" });
      try {
        for await (const [key, value] of iter) {
          if (!key.startsWith("driveSaveArtifacts:")) continue;
          const list = value as Array<{ id: string }>;
          if (list.some((a) => a.id === artifactId)) {
            const [, shop, objectId] = key.split(":");
            await deleteSaveArtifact(shop, objectId, artifactId);
            return { ok: true };
          }
        }
      } finally {
        await iter.close();
      }
      return { ok: true };
    },
  },
  {
    method: "put",
    pattern: /^\/profile\/games\/artifacts\/([^/]+)$/,
    handle: async (match, config) => {
      const artifactId = match[1];
      const body = parseBody(config);
      const label = typeof body.label === "string" ? body.label : "";
      const { db } = await import("@main/level");
      const iter = db.iterator<string, unknown>({ valueEncoding: "json" });
      try {
        for await (const [key, value] of iter) {
          if (!key.startsWith("driveSaveArtifacts:")) continue;
          const list = value as Array<{ id: string }>;
          if (list.some((a) => a.id === artifactId)) {
            const [, shop, objectId] = key.split(":");
            await renameSaveArtifact(shop, objectId, artifactId, label);
            return {};
          }
        }
      } finally {
        await iter.close();
      }
      return {};
    },
  },
  {
    method: "put",
    pattern: /^\/profile\/games\/artifacts\/[^/]+\/(freeze|unfreeze)$/,
    handle: async () => ({}),
  },

  // --- Custom artwork ---
  {
    method: "post",
    pattern: /^\/profile\/games\/([^/]+)\/([^/]+)\/artwork\/(grids|heroes|logos|icons)\/upload-url$/,
    handle: async (match, config) => {
      const [, shop, objectId, kind] = match;
      const body = parseBody(config);
      const ext = String(body.imageExt ?? "png").toLowerCase();
      const size = Number(body.imageLength ?? 0);
      // Return a "presigned URL" that points to a local main-process
      // endpoint that captures the follow-up PUT and forwards it to Drive.
      // The trick: we don't need to run a real HTTP server for that; the
      // adapter also handles the follow-up axios PUT to this local URL and
      // does the Drive upload inline.
      const stagingUrl = `hydra-hybrid://artwork/${shop}/${objectId}/${kind}/${ext}/${size}`;
      return {
        presignedUrl: stagingUrl,
        imageUrl: stagingUrl.replace("hydra-hybrid://", "hydra-hybrid-uploaded://"),
      };
    },
  },
  {
    method: "put",
    pattern: /^\/profile\/games\/([^/]+)\/([^/]+)\/artwork\/(grids|heroes|logos|icons)$/,
    handle: async (_match, config) => {
      const body = parseBody(config);
      if (body.source === "upload" && typeof body.url === "string" &&
          body.url.startsWith("hydra-hybrid-uploaded://")) {
        // Nothing else to do — the PUT to the staging URL already stored the
        // file in Drive and updated the local metadata. Just acknowledge.
        return {};
      }
      if (body.source === "steamgriddb" && typeof body.url === "string") {
        // For SteamGridDB we don't upload anything — we just record the URL
        // locally so custom artwork survives across launches. The renderer
        // reads it back via its own Level DB sublevel already.
        return {};
      }
      logger.warn("[hybrid] unknown artwork PUT payload", body);
      return {};
    },
  },
  {
    method: "delete",
    pattern: /^\/profile\/games\/([^/]+)\/([^/]+)\/artwork\/(grids|heroes|logos|icons)$/,
    handle: async (match) => {
      const [, shop, objectId, kind] = match;
      await clearCustomArtwork(shop, objectId, kind as ArtworkKind);
      return {};
    },
  },

  // --- Emulation cloud saves ---
  {
    method: "post",
    pattern: /^\/profile\/emulation-saves\/upload-url$/,
    handle: async (_m, config) => {
      const body = parseBody(config);
      const stagingUrl =
        `hydra-hybrid://emulation-save/${encodeURIComponent(body.platform)}/${encodeURIComponent(body.emulator)}/${encodeURIComponent(body.saveIdentity)}` +
        `?shop=${encodeURIComponent(body.shop ?? "")}&objectId=${encodeURIComponent(body.objectId ?? "")}`;
      return { id: `pending-${Date.now()}`, uploadUrl: stagingUrl };
    },
  },
  {
    method: "post",
    pattern: /^\/profile\/emulation-saves\/([^/]+)\/commit$/,
    handle: async (match, config) => {
      // The staging PUT already stored the file; commit just returns the
      // metadata shape the client expects. Look up the most recently
      // uploaded save with matching size and return it.
      const body = parseBody(config);
      const list = await listEmulationSaves({});
      const record = list.find(
        (r) => r.sizeBytes === body.artifactLengthInBytes && r.fileName !== body.fileName
      ) ?? list[list.length - 1];
      if (record && (body.label || body.fileName || body.hostname)) {
        await updateEmulationSaveLabel(record.id, body.label ?? record.label);
      }
      void match;
      return serializeEmulationSave(record ?? null, body);
    },
  },
  {
    method: "get",
    pattern: /^\/profile\/emulation-saves$/,
    handle: async (_m, config) => {
      const params = parseSearchParams(config.url);
      const list = await listEmulationSaves({
        platform: params.get("platform") ?? undefined,
        emulator: params.get("emulator") ?? undefined,
        shop: params.get("shop") ?? undefined,
        objectId: params.get("objectId") ?? undefined,
      });
      return list.map((r) => serializeEmulationSave(r, null));
    },
  },
  {
    method: "post",
    pattern: /^\/profile\/emulation-saves\/([^/]+)\/download-url$/,
    handle: async (match) => {
      const id = match[1];
      // We need a URL the client can axios.get(...responseType:'arraybuffer').
      // We stage the bytes to a tmp file and return a hybrid:// URL that the
      // adapter's inline-GET handler streams from.
      const buffer = await downloadEmulationSave(id);
      const tmp = path.join(SystemPath.getPath("temp"), `hybrid-em-${id}.bin`);
      await fs.promises.writeFile(tmp, buffer);
      return { downloadUrl: `hydra-hybrid://download-file?path=${encodeURIComponent(tmp)}` };
    },
  },
  {
    method: "delete",
    pattern: /^\/profile\/emulation-saves\/([^/]+)$/,
    handle: async (match) => {
      await deleteEmulationSave(match[1]);
      return {};
    },
  },
  {
    method: "put",
    pattern: /^\/profile\/emulation-saves\/([^/]+)$/,
    handle: async (match, config) => {
      const body = parseBody(config);
      const record = await updateEmulationSaveLabel(match[1], body.label ?? null);
      return serializeEmulationSave(record, null);
    },
  },

  // --- Profile image / banner (presigned upload URLs) ---
  {
    method: "post",
    pattern: /^\/presigned-urls\/(profile-image|background-image)$/,
    handle: async (match, config) => {
      const which = match[1] as "profile-image" | "background-image";
      const body = parseBody(config);
      const ext = String(body.imageExt ?? "png").toLowerCase();
      const size = Number(body.imageLength ?? 0);
      const stagingUrl = `hydra-hybrid://profile-image/${which}/${ext}/${size}`;
      // The `profileImageUrl` / `backgroundImageUrl` returned here goes into
      // the client's follow-up PATCH /profile. We use a `hydra-hybrid://`
      // sentinel so the PATCH interceptor can recognize it and pull the real
      // Drive URL from local state (already stored by the PUT handler).
      const responseKey = which === "profile-image" ? "profileImageUrl" : "backgroundImageUrl";
      return {
        presignedUrl: stagingUrl,
        [responseKey]: stagingUrl.replace("hydra-hybrid://", "hydra-hybrid-uploaded://"),
      };
    },
  },
];

function serializeEmulationSave(record: any, commitBody: any): unknown {
  if (!record) return null;
  return {
    id: record.id,
    platform: record.platform,
    emulator: record.emulator,
    saveKind: "game_save",
    saveIdentity: record.saveIdentity,
    artifactLengthInBytes: record.sizeBytes,
    fileName: commitBody?.fileName ?? record.fileName,
    hostname: commitBody?.hostname ?? record.hostname,
    localLastModifiedAt: commitBody?.localLastModifiedAt ?? null,
    label: record.label,
    metadata: null,
    shop: record.shop,
    objectId: record.objectId,
    lastUploadedAt: record.updatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function handleHybridPut(config: AxiosRequestConfig): Promise<AxiosResponse | null> {
  const url = config.url ?? "";
  if (!url.startsWith("hydra-hybrid://")) return null;

  const body = config.data;
  const buffer = Buffer.isBuffer(body)
    ? body
    : typeof body === "string"
      ? Buffer.from(body)
      : body instanceof ArrayBuffer
        ? Buffer.from(body)
        : body?.buffer
          ? Buffer.from(body.buffer)
          : Buffer.alloc(0);

  const stripped = url.replace("hydra-hybrid://", "");
  const [prefix, ...rest] = stripped.split("/");

  if (prefix === "profile-image") {
    const [which, ext] = rest;
    const asset = which === "profile-image" ? "profile-image" : "background-image";
    const mimeType = String(config.headers?.["Content-Type"] ?? "image/png");
    await uploadProfileAsset(asset as any, buffer, ext, mimeType);
    return ok({}, config);
  }

  if (prefix === "artwork") {
    const [shop, objectId, kind, ext] = rest;
    const mimeType = String(config.headers?.["Content-Type"] ?? `image/${ext}`);
    await uploadCustomArtwork(shop, objectId, kind as ArtworkKind, buffer, ext, mimeType);
    return ok({}, config);
  }

  if (prefix === "emulation-save") {
    const [platform, emulator, saveIdentity] = rest.map((s) => decodeURIComponent(s.split("?")[0]));
    const params = new URLSearchParams(stripped.includes("?") ? stripped.split("?")[1] : "");
    await upsertEmulationSave(buffer, {
      id: `em-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      platform: platform as "ps1" | "ps2",
      emulator,
      saveIdentity,
      saveKind: "game_save",
      fileName: `${saveIdentity}.bin`,
      hostname: null,
      label: null,
      shop: params.get("shop") || null,
      objectId: params.get("objectId") || null,
      localLastModifiedAt: null,
    });
    return ok({}, config);
  }

  return null;
}

async function handleHybridGet(config: AxiosRequestConfig): Promise<AxiosResponse | null> {
  const url = config.url ?? "";
  if (!url.startsWith("hydra-hybrid://download-file")) return null;
  const params = new URLSearchParams(url.split("?")[1] ?? "");
  const filePath = params.get("path");
  if (!filePath) return null;
  const data = await fs.promises.readFile(filePath);
  const response: AxiosResponse = {
    data: config.responseType === "arraybuffer" ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: config as any,
    request: {},
  };
  fs.promises.unlink(filePath).catch(() => undefined);
  return response;
}

function normalizeProfilePatch(config: AxiosRequestConfig): AxiosRequestConfig {
  if (config.method?.toLowerCase() !== "patch") return config;
  if (stripQuery(config.url) !== "/profile") return config;
  const body = parseBody(config);
  let mutated = false;
  const patched = { ...body };
  for (const key of ["profileImageUrl", "backgroundImageUrl"] as const) {
    const val = patched[key];
    if (typeof val === "string" && val.startsWith("hydra-hybrid-uploaded://")) {
      // The real URL is already stored in Level DB by the PUT handler and the
      // /profile/me response interceptor injects it on read. Hydra's schema
      // rejects `null` here (400: "Expected string, received null"), so we
      // omit the field entirely — Hydra leaves whatever it had unchanged,
      // and our local override wins on the way back down.
      delete patched[key];
      mutated = true;
    }
  }
  if (!mutated) return config;
  return { ...config, data: JSON.stringify(patched), headers: { ...config.headers, "Content-Type": "application/json" } };
}

async function normalizeProfileAssetClear(config: AxiosRequestConfig): Promise<AxiosRequestConfig> {
  if (config.method?.toLowerCase() !== "patch") return config;
  if (stripQuery(config.url) !== "/profile") return config;
  const body = parseBody(config);
  if (body.profileImageUrl === null) await clearProfileAsset("profile-image").catch(() => undefined);
  if (body.backgroundImageUrl === null) await clearProfileAsset("background-image").catch(() => undefined);
  return config;
}

export function createHybridAdapter(
  defaultAdapterConfig: unknown
): AxiosAdapter {
  // In axios 1.x, `axios.defaults.adapter` is a list of adapter names
  // (['xhr','http','fetch']) that axios resolves at request time — not a
  // callable function. We resolve it here once and then invoke it directly
  // for pass-through requests.
  const defaultAdapter = axios.getAdapter(defaultAdapterConfig as any);

  return async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
    const method = (config.method ?? "get").toLowerCase() as Method;
    const rawUrl = config.url ?? "";
    const urlPath = stripQuery(rawUrl);

    // hydra-hybrid:// staging URLs never touch the network.
    if (rawUrl.startsWith("hydra-hybrid://")) {
      if (method === "put") {
        const hit = await handleHybridPut(config);
        if (hit) return hit;
      }
      if (method === "get") {
        const hit = await handleHybridGet(config);
        if (hit) return hit;
      }
      return ok({}, config);
    }

    // Rewrite outgoing profile PATCHes so hydra-hybrid-uploaded:// sentinels
    // are stripped before the request hits Hydra, and clear cached Drive URLs
    // if the caller sent nulls to reset the image.
    const rewritten = await normalizeProfileAssetClear(normalizeProfilePatch(config));

    for (const h of handlers) {
      if (h.method !== method) continue;
      const m = urlPath.match(h.pattern);
      if (!m) continue;
      try {
        const data = await h.handle(m, rewritten);
        return ok(data, rewritten, data === undefined || data === null ? 204 : 200);
      } catch (err) {
        logger.error("[hybrid] handler error", { url: rawUrl, err });
        throw err;
      }
    }

    return defaultAdapter(rewritten as any) as Promise<AxiosResponse>;
  };
}
