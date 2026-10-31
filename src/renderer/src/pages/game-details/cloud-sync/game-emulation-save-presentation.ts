import type { MemoryCardSaveRecord } from "@types";

export const getLocalSaveDeviceLabel = (
  record: Pick<MemoryCardSaveRecord, "cardLabel" | "hostname">
): string => record.hostname?.trim() || record.cardLabel;
