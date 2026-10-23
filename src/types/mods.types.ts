export type ModLoaderId = "bepinex" | "melonloader";

export interface ThunderstoreVersion {
  version: string;
  dependencies: string[];
  downloadUrl: string;
  fileSize: number;
}

export interface ThunderstorePackage {
  fullName: string; // Owner-Name
  owner: string;
  name: string;
  description: string;
  icon: string;
  rating: number;
  downloads: number;
  categories: string[];
  isDeprecated: boolean;
  isNsfw: boolean;
  dateUpdated: string;
  packageUrl: string;
  versions: ThunderstoreVersion[]; // newest first
}

export interface ThunderstoreCommunity {
  identifier: string;
  name: string;
}

export type ModSort = "downloads" | "rating" | "updated" | "name";

export interface ModSearchOptions {
  query?: string;
  sort?: ModSort;
  page?: number;
  pageSize?: number;
  category?: string;
  includeDeprecated?: boolean;
  includeNsfw?: boolean;
}

export interface ModSearchResult {
  items: ThunderstorePackage[];
  total: number;
  categories: string[];
}

export interface InstalledMod {
  fullName: string;
  version: string;
  files: string[]; // relative to game dir
  backups: Record<string, string>; // relative game path -> backup file path
  enabled: boolean;
  isDependency: boolean;
  installedAt: string;
}

export interface GameModState {
  community: string | null;
  loader: ModLoaderId | null;
  installed: Record<string, InstalledMod>;
}

export interface ModProgressEvent {
  shop: string;
  objectId: string;
  fullName: string;
  stage:
    | "resolving"
    | "downloading"
    | "extracting"
    | "installing"
    | "done"
    | "error";
  percent: number;
  message?: string;
}

export interface ModGameStatus {
  community: string | null;
  loader: ModLoaderId | null;
  gameDir: string | null;
  installed: InstalledMod[];
}
