import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { registerEvent } from "../register-event";
import { buildLocalLaunchboxAssetIndex } from "./memcard-local-assets";
import { WindowManager, emulators, logger } from "@main/services";
import type {
  LaunchboxShopDetailsAssetsResponse,
  Ps1Save,
} from "@main/services/emulators";
import { levelKeys, ps1MemoryCardSavesSublevel } from "@main/level";
import type {
  MemcardScanInput,
  MemcardScanProgress,
  MemoryCardSaveRecord,
} from "@types";

const MEMCARD_FILE_RE = /\.(mcd|mcr|mc|gme|vgs|vmp|ps1)$/i;

const inflight = new Map<string, { cancelled: boolean }>();

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
};

// A manual selection may be a memory card file or a folder of cards.
const expandManualPath = async (target: string): Promise<string[]> => {
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(target);
      return entries
        .filter((name) => MEMCARD_FILE_RE.test(name))
        .map((name) => path.join(target, name));
    }
    return [target];
  } catch {
    return [];
  }
};

const runScan = async (
  input: MemcardScanInput,
  signal: { cancelled: boolean },
  emit: (payload: MemcardScanProgress) => void
): Promise<void> => {
  const config = await emulators.getEmulatorConfig("ps1");

  const cardFiles = new Set<string>();
  if (input.autoDetect) {
    for (const file of await emulators.resolvePs1MemcardFiles(
      config.executablePath
    )) {
      cardFiles.add(file);
    }
  }
  for (const manual of input.manualPaths ?? []) {
    for (const file of await expandManualPath(manual)) cardFiles.add(file);
  }
  const files = Array.from(cardFiles);

  // Phase A — parse each card and collect its saves.
  const detected: Array<{
    cardFilePath: string;
    cardLabel: string;
    save: Ps1Save;
  }> = [];
  let processed = 0;
  for (const file of files) {
    if (signal.cancelled) {
      emit({
        type: "cancelled",
        cardCount: files.length,
        saveCount: detected.length,
      });
      return;
    }
    emit({
      type: "scan_progress",
      processed,
      total: files.length,
      currentCard: path.basename(file),
    });
    const info = await emulators.listPs1Saves(file);
    if (info) {
      for (const save of info.saves) {
        detected.push({
          cardFilePath: file,
          cardLabel: path.basename(file),
          save,
        });
      }
    }
    processed += 1;
  }
  emit({
    type: "scan_progress",
    processed,
    total: files.length,
    currentCard: null,
  });

  // Phase B — resolve unique SKUs to LaunchBox metadata, then persist records.
  const skus = Array.from(
    new Set(
      detected
        .map((d) => d.save.sku)
        .filter((sku): sku is string => Boolean(sku))
    )
  );
  const lookup = await emulators.fetchShopDetailsForSkus(skus);
  const localIndex = await buildLocalLaunchboxAssetIndex();

  let matched = 0;
  let unmatched = 0;
  let index = 0;
  for (const { cardFilePath, cardLabel, save } of detected) {
    if (signal.cancelled) {
      emit({
        type: "cancelled",
        cardCount: files.length,
        saveCount: detected.length,
      });
      return;
    }
    // Remote shop-details first; fall back to the local library when it misses.
    let assets: LaunchboxShopDetailsAssetsResponse | null = null;
    if (save.sku) {
      const norm = emulators.normalizeSku(save.sku);
      const entry = lookup.get(norm);
      assets = entry
        ? emulators.mapEntryToAssets(entry)
        : (localIndex.get(norm) ?? null);
    }
    if (assets) matched += 1;
    else unmatched += 1;

    // `folderName` holds the on-card identifier; `fileCount` holds block count.
    // PS1 directory entries carry no timestamps, so created/modified stay 0.
    const record: MemoryCardSaveRecord = {
      cardFilePath,
      cardLabel,
      folderName: save.identifier,
      sku: save.sku ?? null,
      objectId: assets?.objectId ?? null,
      shop: assets ? "launchbox" : null,
      title: assets?.title || null,
      iconUrl: assets?.iconUrl ?? null,
      libraryImageUrl: assets?.libraryImageUrl ?? null,
      libraryHeroImageUrl: assets?.libraryHeroImageUrl ?? null,
      logoImageUrl: assets?.logoImageUrl ?? null,
      fileCount: save.blockCount,
      sizeBytes: save.sizeBytes,
      createdAt: 0,
      modifiedAt: 0,
      detectedAt: Date.now(),
    };
    await ps1MemoryCardSavesSublevel.put(
      levelKeys.ps1MemoryCardSave(cardFilePath, save.identifier),
      record
    );

    index += 1;
    emit({
      type: "match_progress",
      processed: index,
      total: detected.length,
      currentSave: save.identifier,
      status: assets ? "matched" : "unmatched",
      matched,
      unmatched,
    });
  }

  // Prune stale records so removed/renamed cards and deleted saves drop off the
  // list automatically: a save that vanished from a card we just scanned, or any
  // record whose card file no longer exists on disk.
  const detectedKeys = new Set(
    detected.map((d) =>
      levelKeys.ps1MemoryCardSave(d.cardFilePath, d.save.identifier)
    )
  );
  const staleKeys: string[] = [];
  for (const [key, rec] of await ps1MemoryCardSavesSublevel.iterator().all()) {
    if (cardFiles.has(rec.cardFilePath)) {
      if (!detectedKeys.has(key)) staleKeys.push(key);
    } else if (!(await fileExists(rec.cardFilePath))) {
      staleKeys.push(key);
    }
  }
  for (const key of staleKeys) {
    await ps1MemoryCardSavesSublevel.del(key);
  }

  emit({
    type: "done",
    cardCount: files.length,
    saveCount: detected.length,
    matched,
    unmatched,
  });
};

const scanPs1Memcards = async (
  _event: Electron.IpcMainInvokeEvent,
  input: MemcardScanInput
) => {
  const requestId = randomUUID();
  const signal = { cancelled: false };
  inflight.set(requestId, signal);
  const channel = `on-ps1-memcard-scan-progress-${requestId}`;
  const emit = (payload: MemcardScanProgress) => {
    WindowManager.mainWindow?.webContents.send(channel, payload);
  };

  void (async () => {
    try {
      await runScan(input, signal, emit);
    } catch (err) {
      logger.error("PS1 memory card scan failed", err);
      emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflight.delete(requestId);
    }
  })();

  return { requestId };
};

const cancelPs1MemcardScan = async (
  _event: Electron.IpcMainInvokeEvent,
  requestId: string
) => {
  const signal = inflight.get(requestId);
  if (signal) signal.cancelled = true;
};

registerEvent("scanPs1Memcards", scanPs1Memcards);
registerEvent("cancelPs1MemcardScan", cancelPs1MemcardScan);
