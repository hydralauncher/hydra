import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { app } from "electron";
import { Downloader } from "@shared";
import { logger } from "../logger";
import { SystemPath } from "../system-path";

interface UnlockerManifestModule {
  id: string;
  downloader: string;
  source: string;
  sha256: string;
  minLauncherVersion?: string;
}

interface UnlockerManifest {
  version: number;
  generatedAt: string;
  commit: string;
  runtimeApiVersion: number;
  modules: UnlockerManifestModule[];
}

interface UnlockerState {
  etag?: string;
  activeCommit?: string;
}

export interface OtaUnlockResult {
  url: string;
  headers?: Record<string, string>;
  filename?: string;
}

const OTA_UNLOCKERS_PATH = path.join(
  SystemPath.getPath("userData"),
  "unlockers"
);
const MODULES_PATH = path.join(OTA_UNLOCKERS_PATH, "modules");
const MANIFEST_CACHE_PATH = path.join(OTA_UNLOCKERS_PATH, "manifest.json");
const STATE_PATH = path.join(OTA_UNLOCKERS_PATH, "state.json");

const DEFAULT_MANIFEST_URL =
  "https://raw.githubusercontent.com/hydralauncher/hydra/unlockers-live/unlockers/manifest.json";
const DEFAULT_SIGNATURE_URL = `${DEFAULT_MANIFEST_URL}.sig`;

const ALLOWED_MANIFEST_HOSTS = new Set(["raw.githubusercontent.com"]);
const ALLOWED_MODULE_URL_PREFIXES = [
  "https://raw.githubusercontent.com/hydralauncher/hydra/",
];

const POLL_INTERVAL_MS = 45 * 60 * 1000;
const WORKER_TIMEOUT_MS = 15_000;
const WORKER_MAX_OLD_SPACE_MB = 64;
const OTA_FETCH_TIMEOUT_MS = 15_000;
const VALID_MODULE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

const parseSemver = (value: string): ParsedSemver | null => {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

const compareSemver = (left: ParsedSemver, right: ParsedSemver): number => {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
};

const DOWNLOADER_BY_NAME: Record<string, Downloader> = {
  Gofile: Downloader.Gofile,
  PixelDrain: Downloader.PixelDrain,
  Datanodes: Downloader.Datanodes,
  Mediafire: Downloader.Mediafire,
  Buzzheavier: Downloader.Buzzheavier,
  FuckingFast: Downloader.FuckingFast,
  VikingFile: Downloader.VikingFile,
  Rootz: Downloader.Rootz,
};

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
const crypto = require("node:crypto");

const FORBIDDEN_PATTERNS = [
  /\bimport\b/,
  /\brequire\b/,
  /\bprocess\b/,
  /\bglobal\b/,
  /\bglobalThis\b/,
  /\bFunction\b/,
  /\beval\b/,
  /\bchild_process\b/,
  /\bworker_threads\b/,
  /\bnode:\b/,
  /\bDeno\b/,
  /\bBun\b/,
];

const normalizeHeaders = (headers) => {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (typeof key === "string" && typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
};

const assertHttpsUrl = (rawUrl) => {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("Unlocker HTTP API only accepts https URLs");
  }
  return parsed.toString();
};

const createApi = () => ({
  getText: async (url, options = {}) => {
    const safeUrl = assertHttpsUrl(url);
    const response = await fetch(safeUrl, {
      method: "GET",
      headers: normalizeHeaders(options.headers),
      redirect: "follow",
    });

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      text: await response.text(),
    };
  },

  getJson: async (url, options = {}) => {
    const safeUrl = assertHttpsUrl(url);
    const response = await fetch(safeUrl, {
      method: "GET",
      headers: normalizeHeaders(options.headers),
      redirect: "follow",
    });

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      json: await response.json(),
    };
  },

  postJson: async (url, body = {}, options = {}) => {
    const safeUrl = assertHttpsUrl(url);
    const response = await fetch(safeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...normalizeHeaders(options.headers),
      },
      body: JSON.stringify(body),
      redirect: "follow",
    });

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      json: await response.json(),
    };
  },

  postForm: async (url, body = {}, options = {}) => {
    const safeUrl = assertHttpsUrl(url);
    const form = new URLSearchParams();

    for (const [key, value] of Object.entries(body || {})) {
      if (typeof key !== "string") continue;
      if (value === undefined || value === null) {
        form.append(key, "");
        continue;
      }
      form.append(key, String(value));
    }

    const response = await fetch(safeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...normalizeHeaders(options.headers),
      },
      body: form,
      redirect: "follow",
    });

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      text: await response.text(),
    };
  },

  head: async (url, options = {}) => {
    const safeUrl = assertHttpsUrl(url);
    const response = await fetch(safeUrl, {
      method: "HEAD",
      headers: normalizeHeaders(options.headers),
      redirect: options.followRedirects === false ? "manual" : "follow",
    });

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      headers: Object.fromEntries(response.headers.entries()),
    };
  },

  sha256Hex: (value) => {
    return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
  },
});

const execute = async () => {
  const { code, payload } = workerData;

  if (typeof code !== "string" || code.length === 0) {
    throw new Error("Empty unlocker module code");
  }

  if (code.length > 200_000) {
    throw new Error("Unlocker module too large");
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      throw new Error(
        "Forbidden token found in unlocker module: " + String(pattern)
      );
    }
  }

  const sandbox = {
    module: { exports: {} },
    exports: {},
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
  };

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "hydra-ota-unlocker",
  });

  const wrapped = '"use strict";\n' + code + '\n;module.exports;';
  const script = new vm.Script(wrapped, {
    filename: "unlocker.ts",
  });

  const exportsObj = script.runInContext(context, {
    timeout: 1200,
    microtaskMode: "afterEvaluate",
  });

  if (!exportsObj || typeof exportsObj.unlock !== "function") {
    throw new Error("Unlocker module must export an unlock function");
  }

  const api = createApi();
  const result = await exportsObj.unlock(payload, api);

  let normalized;
  if (typeof result === "string") {
    normalized = { url: result };
  } else if (result && typeof result === "object" && typeof result.url === "string") {
    normalized = {
      url: result.url,
      headers: normalizeHeaders(result.headers || {}),
      filename: typeof result.filename === "string" ? result.filename : undefined,
    };
  } else {
    throw new Error("Unlocker must return a direct download URL or object with a url");
  }

  const parsed = new URL(normalized.url);
  if (parsed.protocol !== "https:") {
    throw new Error("Unlocker returned a non-https URL");
  }

  normalized.url = parsed.toString();

  return normalized;
};

execute()
  .then((result) => {
    parentPort.postMessage({ ok: true, result });
  })
  .catch((error) => {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  });
`;

export class OtaUnlockerService {
  private static isInitialized = false;
  private static isEnabled = false;
  private static isChecking = false;
  private static lastCheckAt = 0;
  private static state: UnlockerState = {};
  private static moduleByDownloader = new Map<Downloader, string>();

  static async initialize() {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;

    if (!this.getPublicKey()) {
      logger.warn(
        "[OtaUnlocker] MAIN_VITE_UNLOCKERS_PUBLIC_KEY is missing. OTA unlockers are disabled."
      );
      return;
    }

    await this.ensureDirectories();
    await this.loadState();
    await this.loadCachedManifest();

    this.isEnabled = true;

    await this.checkForUpdates("startup");
  }

  static async checkForUpdatesPeriodically() {
    if (!this.isEnabled) {
      return;
    }

    if (Date.now() - this.lastCheckAt < POLL_INTERVAL_MS) {
      return;
    }

    await this.checkForUpdates("periodic");
  }

  static async resolveDownload(
    downloader: Downloader,
    sourceUrl: string
  ): Promise<OtaUnlockResult | null> {
    if (downloader === Downloader.Gofile) {
      return null;
    }

    if (!this.isEnabled) {
      return null;
    }

    const modulePath = this.moduleByDownloader.get(downloader);
    if (!modulePath) {
      return null;
    }

    try {
      const code = await fs.promises.readFile(modulePath, "utf8");
      return await this.executeInSandbox(code, {
        url: sourceUrl,
        config: {
          MAIN_VITE_NIMBUS_API_URL: import.meta.env.MAIN_VITE_NIMBUS_API_URL,
        },
      });
    } catch (error) {
      logger.error(
        `[OtaUnlocker] Failed to resolve OTA URL for ${Downloader[downloader]}:`,
        error
      );
      return null;
    }
  }

  private static async checkForUpdates(reason: "startup" | "periodic") {
    if (this.isChecking) {
      return;
    }

    this.isChecking = true;
    this.lastCheckAt = Date.now();

    try {
      await this.fetchAndActivateManifest();
      logger.log(`[OtaUnlocker] Manifest check succeeded (${reason})`);
    } catch (error) {
      logger.error(`[OtaUnlocker] Manifest check failed (${reason}):`, error);
    } finally {
      this.isChecking = false;
    }
  }

  private static getManifestUrl() {
    return (
      import.meta.env.MAIN_VITE_UNLOCKERS_MANIFEST_URL || DEFAULT_MANIFEST_URL
    );
  }

  private static getSignatureUrl() {
    if (import.meta.env.MAIN_VITE_UNLOCKERS_SIGNATURE_URL) {
      return import.meta.env.MAIN_VITE_UNLOCKERS_SIGNATURE_URL;
    }

    const manifestUrl = this.getManifestUrl();
    if (manifestUrl === DEFAULT_MANIFEST_URL) {
      return DEFAULT_SIGNATURE_URL;
    }

    return `${manifestUrl}.sig`;
  }

  private static getPublicKey() {
    return import.meta.env.MAIN_VITE_UNLOCKERS_PUBLIC_KEY?.trim();
  }

  private static getCurrentLauncherVersion() {
    return app.getVersion();
  }

  private static isModuleCompatible(module: UnlockerManifestModule) {
    if (!module.minLauncherVersion) {
      return true;
    }

    const minVersion = parseSemver(module.minLauncherVersion);
    if (!minVersion) {
      logger.warn(
        `[OtaUnlocker] Ignoring module ${module.id}: invalid minLauncherVersion "${module.minLauncherVersion}"`
      );
      return false;
    }

    const currentVersionRaw = this.getCurrentLauncherVersion();
    const currentVersion = parseSemver(currentVersionRaw);
    if (!currentVersion) {
      logger.warn(
        `[OtaUnlocker] Could not parse launcher version "${currentVersionRaw}"; accepting module ${module.id}`
      );
      return true;
    }

    const isCompatible = compareSemver(currentVersion, minVersion) >= 0;
    if (!isCompatible) {
      logger.log(
        `[OtaUnlocker] Skipping module ${module.id}: requires launcher >= ${module.minLauncherVersion}, current ${currentVersionRaw}`
      );
    }

    return isCompatible;
  }

  private static getCompatibleModules(manifest: UnlockerManifest) {
    const compatible: UnlockerManifestModule[] = [];
    for (const module of manifest.modules) {
      if (this.isModuleCompatible(module)) {
        compatible.push(module);
      }
    }
    return compatible;
  }

  private static getModulePath(moduleId: string) {
    return path.join(MODULES_PATH, `${moduleId}.mjs`);
  }

  private static buildModuleMap(
    modules: UnlockerManifestModule[],
    requireExistingFiles: boolean
  ) {
    const moduleMap = new Map<Downloader, string>();
    for (const module of modules) {
      const downloader = DOWNLOADER_BY_NAME[module.downloader];
      const modulePath = this.getModulePath(module.id);
      if (!requireExistingFiles || fs.existsSync(modulePath)) {
        moduleMap.set(downloader, modulePath);
      }
    }
    return moduleMap;
  }

  private static async removeStaleModules(expectedModuleIds: Set<string>) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(MODULES_PATH, {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".mjs")) {
        continue;
      }

      const moduleId = entry.name.slice(0, -4);
      if (expectedModuleIds.has(moduleId)) {
        continue;
      }

      const stalePath = path.join(MODULES_PATH, entry.name);
      await fs.promises.unlink(stalePath).catch(() => {
        // ignore stale cleanup failures
      });
    }
  }

  private static async tryRestoreFromCachedManifest() {
    if (!fs.existsSync(MANIFEST_CACHE_PATH)) {
      return false;
    }

    try {
      const manifestText = await fs.promises.readFile(
        MANIFEST_CACHE_PATH,
        "utf8"
      );
      const manifest = this.parseAndValidateManifest(manifestText);
      const compatibleModules = this.getCompatibleModules(manifest);
      const expectedModuleIds = new Set(
        compatibleModules.map((module) => module.id)
      );
      const missingCompatibleModules = compatibleModules.filter(
        (module) => !fs.existsSync(this.getModulePath(module.id))
      );

      if (missingCompatibleModules.length > 0) {
        logger.warn(
          `[OtaUnlocker] Manifest returned 304 but ${missingCompatibleModules.length} module(s) are missing locally; restoring from cached manifest.`
        );
        await this.downloadAndActivateModules(manifest);
        return true;
      }

      this.moduleByDownloader = this.buildModuleMap(compatibleModules, true);
      await this.removeStaleModules(expectedModuleIds);
      return true;
    } catch (error) {
      logger.warn(
        "[OtaUnlocker] Could not restore modules from cached manifest after 304:",
        error
      );
      return false;
    }
  }

  private static async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = OTA_FETCH_TIMEOUT_MS
  ) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Unlocker OTA request timed out: ${init.method} ${url}`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static async fetchAndActivateManifest(
    options: { bypassEtag?: boolean } = {}
  ) {
    const bypassEtag = options.bypassEtag === true;
    const manifestUrl = this.getManifestUrl();
    const signatureUrl = this.getSignatureUrl();

    this.assertAllowedManifestUrl(manifestUrl);
    this.assertAllowedManifestUrl(signatureUrl);

    const manifestHeaders: Record<string, string> = {};
    if (!bypassEtag && this.state.etag) {
      manifestHeaders["If-None-Match"] = this.state.etag;
    }

    const manifestResponse = await this.fetchWithTimeout(manifestUrl, {
      method: "GET",
      headers: manifestHeaders,
      cache: "no-store",
    });

    if (manifestResponse.status === 304) {
      const restored = await this.tryRestoreFromCachedManifest();
      if (restored) {
        return;
      }

      if (!bypassEtag) {
        logger.warn(
          "[OtaUnlocker] Manifest returned 304 but no usable local cache was found; retrying without ETag."
        );
        await this.fetchAndActivateManifest({ bypassEtag: true });
        return;
      }

      throw new Error("Manifest returned 304 but no local cache was available");
    }

    if (!manifestResponse.ok) {
      throw new Error(
        `Manifest request failed with status ${manifestResponse.status}`
      );
    }

    const manifestText = await manifestResponse.text();

    const signatureResponse = await this.fetchWithTimeout(signatureUrl, {
      method: "GET",
      cache: "no-store",
    });

    if (!signatureResponse.ok) {
      throw new Error(
        `Manifest signature request failed with status ${signatureResponse.status}`
      );
    }

    const signatureBase64 = (await signatureResponse.text()).trim();
    this.verifyManifestSignature(manifestText, signatureBase64);

    const manifest = this.parseAndValidateManifest(manifestText);
    await this.downloadAndActivateModules(manifest);

    const etag = manifestResponse.headers.get("etag") ?? undefined;
    this.state = {
      ...this.state,
      etag,
      activeCommit: manifest.commit,
    };

    await fs.promises.writeFile(MANIFEST_CACHE_PATH, manifestText, "utf8");
    await fs.promises.writeFile(STATE_PATH, JSON.stringify(this.state), "utf8");
  }

  private static verifyManifestSignature(
    manifestText: string,
    signatureBase64: string
  ) {
    const publicKeyPem = this.getPublicKey();
    if (!publicKeyPem) {
      throw new Error("Missing unlocker public key");
    }

    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length === 0) {
      throw new Error("Invalid unlocker manifest signature");
    }

    const key = crypto.createPublicKey(publicKeyPem);
    const isValid = crypto.verify(
      null,
      Buffer.from(manifestText),
      key,
      signature
    );

    if (!isValid) {
      throw new Error("Unlocker manifest signature verification failed");
    }
  }

  private static parseAndValidateManifest(
    manifestText: string
  ): UnlockerManifest {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestText);
    } catch {
      throw new Error("Invalid unlocker manifest JSON");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid unlocker manifest payload");
    }

    const manifest = parsed as UnlockerManifest;

    if (manifest.version !== 1) {
      throw new Error(
        `Unsupported unlocker manifest version: ${manifest.version}`
      );
    }

    if (manifest.runtimeApiVersion !== 1) {
      throw new Error(
        `Unsupported unlocker runtime API version: ${manifest.runtimeApiVersion}`
      );
    }

    if (!Array.isArray(manifest.modules)) {
      throw new Error("Manifest modules must be an array");
    }

    for (const module of manifest.modules) {
      if (
        typeof module.id !== "string" ||
        typeof module.source !== "string" ||
        typeof module.sha256 !== "string" ||
        typeof module.downloader !== "string"
      ) {
        throw new Error("Manifest contains an invalid module entry");
      }

      if (!VALID_MODULE_ID.test(module.id)) {
        throw new Error(`Manifest contains an invalid module id: ${module.id}`);
      }

      if (!SHA256_HEX_PATTERN.test(module.sha256)) {
        throw new Error(
          `Manifest contains an invalid SHA-256 for module: ${module.id}`
        );
      }

      if (
        module.minLauncherVersion !== undefined &&
        typeof module.minLauncherVersion !== "string"
      ) {
        throw new Error(
          `Manifest contains an invalid minLauncherVersion for module: ${module.id}`
        );
      }

      if (!(module.downloader in DOWNLOADER_BY_NAME)) {
        throw new Error(
          `Unsupported downloader in manifest: ${module.downloader}`
        );
      }

      this.assertAllowedModuleSource(module.source);
    }

    return manifest;
  }

  private static async downloadAndActivateModules(manifest: UnlockerManifest) {
    const compatibleModules = this.getCompatibleModules(manifest);
    const nextModuleMap = new Map<Downloader, string>();
    const expectedModuleIds = new Set(
      compatibleModules.map((module) => module.id)
    );

    for (const module of compatibleModules) {
      const response = await this.fetchWithTimeout(module.source, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch unlocker module ${module.id}: HTTP ${response.status}`
        );
      }

      const sourceCode = await response.text();
      const hash = crypto
        .createHash("sha256")
        .update(sourceCode, "utf8")
        .digest("hex");

      if (hash.toLowerCase() !== module.sha256.toLowerCase()) {
        throw new Error(`SHA-256 mismatch for unlocker module ${module.id}`);
      }

      const modulePath = this.getModulePath(module.id);
      await fs.promises.writeFile(modulePath, sourceCode, "utf8");

      const downloader = DOWNLOADER_BY_NAME[module.downloader];
      nextModuleMap.set(downloader, modulePath);
    }

    await this.removeStaleModules(expectedModuleIds);
    this.moduleByDownloader = nextModuleMap;
  }

  private static assertAllowedManifestUrl(rawUrl: string) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      throw new Error(`Manifest URL must be https: ${rawUrl}`);
    }

    if (!ALLOWED_MANIFEST_HOSTS.has(parsed.hostname)) {
      throw new Error(`Manifest host is not allowlisted: ${parsed.hostname}`);
    }
  }

  private static assertAllowedModuleSource(rawUrl: string) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      throw new Error(`Module source URL must be https: ${rawUrl}`);
    }

    if (
      !ALLOWED_MODULE_URL_PREFIXES.some((prefix) => rawUrl.startsWith(prefix))
    ) {
      throw new Error(`Module source is not allowlisted: ${rawUrl}`);
    }

    if (parsed.pathname.includes("..")) {
      throw new Error(
        `Module source URL path traversal is not allowed: ${rawUrl}`
      );
    }
  }

  private static async executeInSandbox(
    code: string,
    payload: Record<string, unknown>
  ): Promise<OtaUnlockResult> {
    return await new Promise<OtaUnlockResult>((resolve, reject) => {
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { code, payload },
        resourceLimits: {
          maxOldGenerationSizeMb: WORKER_MAX_OLD_SPACE_MB,
        },
      });

      const timeout = setTimeout(() => {
        worker.terminate().catch(() => {
          // ignore
        });
        reject(new Error("Unlocker sandbox timeout"));
      }, WORKER_TIMEOUT_MS);

      worker.once("message", (message: unknown) => {
        clearTimeout(timeout);
        worker.terminate().catch(() => {
          // ignore
        });

        if (
          !message ||
          typeof message !== "object" ||
          !("ok" in message) ||
          !("result" in message || "error" in message)
        ) {
          reject(new Error("Invalid unlocker worker response"));
          return;
        }

        const payload = message as {
          ok: boolean;
          result?: OtaUnlockResult;
          error?: string;
        };

        if (!payload.ok) {
          reject(new Error(payload.error ?? "Unlocker worker failed"));
          return;
        }

        if (
          !payload.result ||
          typeof payload.result !== "object" ||
          typeof payload.result.url !== "string"
        ) {
          reject(new Error("Unlocker worker returned invalid result"));
          return;
        }

        resolve(payload.result);
      });

      worker.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private static async ensureDirectories() {
    await fs.promises.mkdir(MODULES_PATH, { recursive: true });
  }

  private static async loadCachedManifest() {
    if (!fs.existsSync(MANIFEST_CACHE_PATH)) {
      return;
    }

    try {
      const manifestText = await fs.promises.readFile(
        MANIFEST_CACHE_PATH,
        "utf8"
      );
      const manifest = this.parseAndValidateManifest(manifestText);
      const compatibleModules = this.getCompatibleModules(manifest);
      const expectedModuleIds = new Set(
        compatibleModules.map((module) => module.id)
      );
      this.moduleByDownloader = this.buildModuleMap(compatibleModules, true);
      await this.removeStaleModules(expectedModuleIds);
    } catch (error) {
      logger.error("[OtaUnlocker] Failed to load cached manifest:", error);
    }
  }

  private static async loadState() {
    if (!fs.existsSync(STATE_PATH)) {
      return;
    }

    try {
      const raw = await fs.promises.readFile(STATE_PATH, "utf8");
      const state = JSON.parse(raw) as UnlockerState;
      this.state = {
        etag: state.etag,
        activeCommit: state.activeCommit,
      };
    } catch (error) {
      logger.error("[OtaUnlocker] Failed to load OTA state:", error);
    }
  }
}
