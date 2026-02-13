import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type { AllDebridUser } from "@types";
import { appVersion } from "@main/constants";
import { logger } from "@main/services";

interface AllDebridError {
  code: string;
  message: string;
}

interface AllDebridApiResponse<T> {
  status: "success" | "error";
  data: T;
  error?: AllDebridError;
}

interface AllDebridUserResponse {
  user: AllDebridUser;
}

interface AllDebridLinkUnlockResponse {
  link: string;
}

interface AllDebridMagnet {
  id: number;
  hash: string;
  status: string;
  links?: { link: string }[];
}

type AllDebridMagnetsPayload =
  | AllDebridMagnet[]
  | AllDebridMagnet
  | Record<string, AllDebridMagnet>;

interface AllDebridMagnetUploadResponse {
  magnets: AllDebridMagnetsPayload;
}

interface AllDebridMagnetStatusResponse {
  magnets: AllDebridMagnetsPayload;
}

export class AllDebridClient {
  private static instance: AxiosInstance;
  private static apiToken: string;
  private static readonly baseURL = "https://api.alldebrid.com/v4";
  private static readonly agent = `Hydra/${appVersion}`;

  static authorize(apiToken: string) {
    this.apiToken = apiToken;
    this.instance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });
  }

  private static getSearchParams(params?: Record<string, string>) {
    return new URLSearchParams({
      apikey: this.apiToken,
      agent: this.agent,
      ...params,
    });
  }

  private static ensureSuccess<T>(payload: AllDebridApiResponse<T>) {
    if (payload.status === "error") {
      throw new Error(payload.error?.message ?? "AllDebrid API error");
    }
  }

  private static normalizeMagnets(
    magnets: AllDebridMagnetsPayload
  ): AllDebridMagnet[] {
    if (Array.isArray(magnets)) return magnets;
    if (!magnets || typeof magnets !== "object") return [];
    if ("id" in magnets && "hash" in magnets) {
      return [magnets as AllDebridMagnet];
    }
    return Object.values(magnets);
  }

  static async getUser() {
    const response = await this.instance.get<
      AllDebridApiResponse<AllDebridUserResponse>
    >(`/user?${this.getSearchParams().toString()}`);
    this.ensureSuccess(response.data);
    return response.data.data.user;
  }

  private static async unlockLink(link: string) {
    const response = await this.instance.get<
      AllDebridApiResponse<AllDebridLinkUnlockResponse>
    >(
      `/link/unlock?${this.getSearchParams({
        link,
      }).toString()}`
    );
    this.ensureSuccess(response.data);

    return response.data.data.link;
  }

  private static async getMagnetStatus(id?: number) {
    const payload = new URLSearchParams({
      agent: this.agent,
      ...(id ? { id: id.toString() } : {}),
    });

    const response = await this.instance.post<
      AllDebridApiResponse<AllDebridMagnetStatusResponse>
    >("https://api.alldebrid.com/v4.1/magnet/status", payload);
    this.ensureSuccess(response.data);
    return this.normalizeMagnets(response.data.data.magnets);
  }

  private static async addMagnet(magnet: string) {
    const response = await this.instance.get<
      AllDebridApiResponse<AllDebridMagnetUploadResponse>
    >(
      `/magnet/upload?${this.getSearchParams({
        "magnets[]": magnet,
      }).toString()}`
    );
    this.ensureSuccess(response.data);
    return this.normalizeMagnets(response.data.data.magnets);
  }

  private static async getMagnetId(magnetUri: string) {
    const { infoHash } = parseTorrent(magnetUri);
    if (!infoHash) {
      return null;
    }

    const hash = infoHash.toLowerCase();

    const userMagnets = await this.getMagnetStatus();
    const existingMagnet = userMagnets.find(
      (magnet) => magnet.hash.toLowerCase() === hash
    );

    if (existingMagnet) return existingMagnet.id;

    const uploadedMagnets = await this.addMagnet(magnetUri);
    const [firstMagnet] = uploadedMagnets;

    return firstMagnet?.id ?? null;
  }

  static async getDownloadUrl(uri: string) {
    if (!uri.startsWith("magnet:")) {
      const unlocked = await this.unlockLink(uri);
      return decodeURIComponent(unlocked);
    }

    const magnetId = await this.getMagnetId(uri);
    if (!magnetId) return null;

    const magnets = await this.getMagnetStatus(magnetId);
    const [magnetStatus] = magnets;
    const [firstLink] = magnetStatus?.links ?? [];

    if (!firstLink?.link) return null;

    const unlocked = await this.unlockLink(firstLink.link);
    return decodeURIComponent(unlocked);
  }

  static async isCached(uri: string) {
    logger.log(`[AllDebrid] Checking cache availability for URI: ${uri}`);
    const downloadUrl = await this.getDownloadUrl(uri);
    const cached = Boolean(downloadUrl);
    logger.log(
      `[AllDebrid] Cache availability check result for URI: ${uri} => ${cached}`
    );
    return cached;
  }
}
