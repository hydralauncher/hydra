import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import {
  findOrCreateFolder,
  uploadFileFromDisk,
  uploadFileFromBuffer,
  downloadFileToDisk,
  downloadFileToBuffer,
  deleteFile,
  makePublic,
} from "./drive-client.js";
import { isDriveConnected } from "./drive-oauth.js";

// The hybrid layer keeps ALL user-authored blobs under a single top-level
// folder in the user's Drive so it's easy to spot, back up, or delete. Inside
// that folder we mirror the shape of Hydra's cloud storage:
//
//   Hydra Cloud (Self-Hosted Hybrid)/
//     saves/
//       {shop}-{objectId}/
//         {artifactId}.tar
//     profile/
//       avatar.{ext}
//       banner.{ext}
//     artwork/
//       {shop}-{objectId}/
//         {grids|heroes|logos|icons}/{fileId}.{ext}
//     emulation-saves/
//       {platform}-{emulator}/
//         {saveIdentity}.bin
//
// Every subfolder is looked up (or created) on demand and its Drive folder ID
// is cached in Level DB so we don't re-query on hot paths.

const ROOT_FOLDER_NAME = "Hydra Cloud (Self-Hosted Hybrid)";

async function getRootFolderId(): Promise<string> {
  const cached = await db
    .get<string, string>(levelKeys.driveRootFolderId, { valueEncoding: "utf8" })
    .catch(() => null);
  if (cached) return cached;
  const id = await findOrCreateFolder(ROOT_FOLDER_NAME, null);
  await db.put(levelKeys.driveRootFolderId, id, { valueEncoding: "utf8" });
  return id;
}

async function getSubfolder(...path: string[]): Promise<string> {
  let parent = await getRootFolderId();
  for (const name of path) {
    parent = await findOrCreateFolder(name, parent);
  }
  return parent;
}

export async function ensureConnected(): Promise<void> {
  if (!(await isDriveConnected())) {
    throw new Error(
      "Google Drive is not connected. Go to Settings → Cloud Storage to connect."
    );
  }
}

// --- Save-game artifacts (per-user, per-game) ---

export interface SaveArtifactMetadata {
  id: string;                  // client-generated UUID
  driveFileId: string;         // Drive's own file id
  sizeBytes: number;
  createdAt: string;
  hostname: string;
  homeDir: string;
  winePrefixPath: string | null;
  downloadOptionTitle: string | null;
  platform: string;
  label: string;
}

export async function listSaveArtifacts(
  shop: string,
  objectId: string
): Promise<SaveArtifactMetadata[]> {
  return (
    (await db
      .get<string, SaveArtifactMetadata[]>(
        levelKeys.driveSaveArtifacts(shop as any, objectId),
        { valueEncoding: "json" }
      )
      .catch(() => null)) ?? []
  );
}

async function writeSaveArtifacts(
  shop: string,
  objectId: string,
  list: SaveArtifactMetadata[]
): Promise<void> {
  await db.put(
    levelKeys.driveSaveArtifacts(shop as any, objectId),
    list,
    { valueEncoding: "json" }
  );
}

export async function uploadSaveArtifact(
  shop: string,
  objectId: string,
  tarPath: string,
  metadata: Omit<SaveArtifactMetadata, "driveFileId" | "sizeBytes" | "createdAt">
): Promise<SaveArtifactMetadata> {
  await ensureConnected();
  const folderId = await getSubfolder("saves", `${shop}-${objectId}`);
  const uploaded = await uploadFileFromDisk(tarPath, {
    name: `${metadata.id}.tar`,
    mimeType: "application/tar",
    parentId: folderId,
    appProperties: {
      hostname: metadata.hostname,
      homeDir: metadata.homeDir,
      winePrefixPath: metadata.winePrefixPath ?? "",
      downloadOptionTitle: metadata.downloadOptionTitle ?? "",
      platform: metadata.platform,
      label: metadata.label,
    },
  });
  const record: SaveArtifactMetadata = {
    ...metadata,
    driveFileId: uploaded.id,
    sizeBytes: Number(uploaded.size ?? 0),
    createdAt: uploaded.createdTime ?? new Date().toISOString(),
  };
  const list = await listSaveArtifacts(shop, objectId);
  list.unshift(record);
  await writeSaveArtifacts(shop, objectId, list);
  return record;
}

export async function downloadSaveArtifact(
  shop: string,
  objectId: string,
  artifactId: string,
  destPath: string
): Promise<SaveArtifactMetadata> {
  await ensureConnected();
  const list = await listSaveArtifacts(shop, objectId);
  const entry = list.find((a) => a.id === artifactId);
  if (!entry) throw new Error("Artifact not found");
  await downloadFileToDisk(entry.driveFileId, destPath);
  return entry;
}

export async function deleteSaveArtifact(
  shop: string,
  objectId: string,
  artifactId: string
): Promise<void> {
  await ensureConnected();
  const list = await listSaveArtifacts(shop, objectId);
  const entry = list.find((a) => a.id === artifactId);
  if (!entry) return;
  await deleteFile(entry.driveFileId).catch(() => undefined);
  await writeSaveArtifacts(
    shop,
    objectId,
    list.filter((a) => a.id !== artifactId)
  );
}

export async function renameSaveArtifact(
  shop: string,
  objectId: string,
  artifactId: string,
  label: string
): Promise<void> {
  const list = await listSaveArtifacts(shop, objectId);
  const idx = list.findIndex((a) => a.id === artifactId);
  if (idx < 0) return;
  list[idx] = { ...list[idx], label };
  await writeSaveArtifacts(shop, objectId, list);
}

// --- Profile assets (avatar + banner) ---

export type ProfileAsset = "profile-image" | "background-image";

export async function uploadProfileAsset(
  asset: ProfileAsset,
  data: Buffer,
  ext: string,
  mimeType: string
): Promise<string> {
  await ensureConnected();
  const folderId = await getSubfolder("profile");

  // Replace any existing avatar/banner so the user's Drive doesn't accumulate
  // orphaned copies.
  const previousUrl = await db
    .get<string, string>(
      asset === "profile-image"
        ? levelKeys.driveProfileImageUrl
        : levelKeys.driveBackgroundImageUrl,
      { valueEncoding: "utf8" }
    )
    .catch(() => null);
  if (previousUrl) {
    const oldId = extractDriveIdFromUrl(previousUrl);
    if (oldId) await deleteFile(oldId).catch(() => undefined);
  }

  const uploaded = await uploadFileFromBuffer(data, {
    name: `${asset === "profile-image" ? "avatar" : "banner"}.${ext}`,
    mimeType,
    parentId: folderId,
  });
  const publicUrl = await makePublic(uploaded.id);
  await db.put(
    asset === "profile-image"
      ? levelKeys.driveProfileImageUrl
      : levelKeys.driveBackgroundImageUrl,
    publicUrl,
    { valueEncoding: "utf8" }
  );
  return publicUrl;
}

export async function clearProfileAsset(asset: ProfileAsset): Promise<void> {
  const key =
    asset === "profile-image"
      ? levelKeys.driveProfileImageUrl
      : levelKeys.driveBackgroundImageUrl;
  const url = await db
    .get<string, string>(key, { valueEncoding: "utf8" })
    .catch(() => null);
  if (url) {
    const id = extractDriveIdFromUrl(url);
    if (id) await deleteFile(id).catch(() => undefined);
    await db.del(key).catch(() => undefined);
  }
}

export async function getStoredProfileAssetUrls(): Promise<{
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
}> {
  const [profileImageUrl, backgroundImageUrl] = await Promise.all([
    db
      .get<string, string>(levelKeys.driveProfileImageUrl, { valueEncoding: "utf8" })
      .catch(() => null),
    db
      .get<string, string>(levelKeys.driveBackgroundImageUrl, { valueEncoding: "utf8" })
      .catch(() => null),
  ]);
  return {
    profileImageUrl: profileImageUrl ?? null,
    backgroundImageUrl: backgroundImageUrl ?? null,
  };
}

function extractDriveIdFromUrl(url: string): string | null {
  const match = /[?&]id=([^&]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

// --- Custom artwork (per-game, per-kind) ---

export type ArtworkKind = "grids" | "heroes" | "logos" | "icons";

export async function uploadCustomArtwork(
  shop: string,
  objectId: string,
  kind: ArtworkKind,
  fileBuffer: Buffer,
  ext: string,
  mimeType: string
): Promise<string> {
  await ensureConnected();
  const folderId = await getSubfolder("artwork", `${shop}-${objectId}`, kind);

  const previous = await db
    .get<string, string>(
      levelKeys.driveCustomArtwork(shop as any, objectId, kind),
      { valueEncoding: "utf8" }
    )
    .catch(() => null);
  if (previous) {
    const oldId = extractDriveIdFromUrl(previous);
    if (oldId) await deleteFile(oldId).catch(() => undefined);
  }

  const uploaded = await uploadFileFromBuffer(fileBuffer, {
    name: `artwork.${ext}`,
    mimeType,
    parentId: folderId,
  });
  const url = await makePublic(uploaded.id);
  await db.put(
    levelKeys.driveCustomArtwork(shop as any, objectId, kind),
    url,
    { valueEncoding: "utf8" }
  );
  return url;
}

export async function clearCustomArtwork(
  shop: string,
  objectId: string,
  kind: ArtworkKind
): Promise<void> {
  const url = await db
    .get<string, string>(
      levelKeys.driveCustomArtwork(shop as any, objectId, kind),
      { valueEncoding: "utf8" }
    )
    .catch(() => null);
  if (url) {
    const id = extractDriveIdFromUrl(url);
    if (id) await deleteFile(id).catch(() => undefined);
    await db.del(levelKeys.driveCustomArtwork(shop as any, objectId, kind))
      .catch(() => undefined);
  }
}

// --- Emulation saves (PS1/PS2 memory-card slots) ---

export interface EmulationSaveMetadata {
  id: string;
  driveFileId: string;
  platform: "ps1" | "ps2";
  emulator: string;
  saveIdentity: string;
  saveKind: "game_save";
  fileName: string;
  hostname: string | null;
  label: string | null;
  shop: string | null;
  objectId: string | null;
  sizeBytes: number;
  localLastModifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

async function loadEmulationSaves(): Promise<EmulationSaveMetadata[]> {
  return (
    (await db
      .get<string, EmulationSaveMetadata[]>(levelKeys.driveEmulationSaves, {
        valueEncoding: "json",
      })
      .catch(() => null)) ?? []
  );
}

async function writeEmulationSaves(list: EmulationSaveMetadata[]): Promise<void> {
  await db.put(levelKeys.driveEmulationSaves, list, { valueEncoding: "json" });
}

export async function upsertEmulationSave(
  data: Buffer,
  metadata: Omit<EmulationSaveMetadata, "driveFileId" | "sizeBytes" | "createdAt" | "updatedAt">
): Promise<EmulationSaveMetadata> {
  await ensureConnected();
  const folderId = await getSubfolder(
    "emulation-saves",
    `${metadata.platform}-${metadata.emulator}`
  );
  const list = await loadEmulationSaves();
  const existingIdx = list.findIndex(
    (s) =>
      s.platform === metadata.platform &&
      s.emulator === metadata.emulator &&
      s.saveIdentity === metadata.saveIdentity
  );
  if (existingIdx >= 0) {
    await deleteFile(list[existingIdx].driveFileId).catch(() => undefined);
  }

  const uploaded = await uploadFileFromBuffer(data, {
    name: `${sanitize(metadata.saveIdentity)}.bin`,
    mimeType: "application/octet-stream",
    parentId: folderId,
  });
  const now = new Date().toISOString();
  const record: EmulationSaveMetadata = {
    ...metadata,
    driveFileId: uploaded.id,
    sizeBytes: data.length,
    createdAt: existingIdx >= 0 ? list[existingIdx].createdAt : now,
    updatedAt: now,
  };
  if (existingIdx >= 0) list[existingIdx] = record;
  else list.push(record);
  await writeEmulationSaves(list);
  return record;
}

export async function listEmulationSaves(
  filter: {
    platform?: string;
    emulator?: string;
    shop?: string;
    objectId?: string;
  } = {}
): Promise<EmulationSaveMetadata[]> {
  const list = await loadEmulationSaves();
  return list.filter((s) => {
    if (filter.platform && s.platform !== filter.platform) return false;
    if (filter.emulator && s.emulator !== filter.emulator) return false;
    if (filter.shop && s.shop !== filter.shop) return false;
    if (filter.objectId && s.objectId !== filter.objectId) return false;
    return true;
  });
}

export async function downloadEmulationSave(id: string): Promise<Buffer> {
  await ensureConnected();
  const list = await loadEmulationSaves();
  const entry = list.find((s) => s.id === id);
  if (!entry) throw new Error("Emulation save not found");
  return downloadFileToBuffer(entry.driveFileId);
}

export async function deleteEmulationSave(id: string): Promise<void> {
  const list = await loadEmulationSaves();
  const entry = list.find((s) => s.id === id);
  if (!entry) return;
  await deleteFile(entry.driveFileId).catch(() => undefined);
  await writeEmulationSaves(list.filter((s) => s.id !== id));
}

export async function updateEmulationSaveLabel(
  id: string,
  label: string | null
): Promise<EmulationSaveMetadata | null> {
  const list = await loadEmulationSaves();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], label, updatedAt: new Date().toISOString() };
  await writeEmulationSaves(list);
  return list[idx];
}

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "save";
}
