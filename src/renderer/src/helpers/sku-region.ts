export type SkuRegion = "US" | "EU" | "JP" | "KR" | "ASIA";

const SONY_SKU_REGION_MAP: Record<string, SkuRegion> = {
  SCUS: "US",
  SLUS: "US",
  SCUD: "US",
  SLUD: "US",
  BCUS: "US",
  BLUS: "US",
  BCUD: "US",
  NPUA: "US",
  NPUB: "US",
  SCES: "EU",
  SLES: "EU",
  SCED: "EU",
  SLED: "EU",
  BCES: "EU",
  BLES: "EU",
  BCED: "EU",
  NPEA: "EU",
  NPEB: "EU",
  SCPS: "JP",
  SLPS: "JP",
  SLPM: "JP",
  SIPS: "JP",
  PAPX: "JP",
  PCPX: "JP",
  SRPM: "JP",
  BCJS: "JP",
  BLJS: "JP",
  BLJM: "JP",
  NPJA: "JP",
  NPJB: "JP",
  NPJD: "JP",
  SCKA: "KR",
  SLKA: "KR",
  BCKS: "KR",
  BLKS: "KR",
  BCKD: "KR",
  BCAS: "ASIA",
  BLAS: "ASIA",
  NPHA: "ASIA",
  NPHB: "ASIA",
};

const PSP_DISC_ID_RE = /^(?:UL|UC|NP)([A-Z])[A-Z][-_ .]?\d{5}$/;

const PSP_REGION_MAP: Partial<Record<string, SkuRegion>> = {
  U: "US",
  E: "EU",
  J: "JP",
  K: "KR",
  A: "ASIA",
  H: "ASIA",
};

const DOLPHIN_GAME_ID_RE = /^[A-Z0-9]{6}$/;

const DOLPHIN_REGION_MAP: Partial<Record<string, SkuRegion>> = {
  B: "US",
  E: "US",
  N: "US",
  D: "EU",
  F: "EU",
  H: "EU",
  I: "EU",
  L: "EU",
  M: "EU",
  P: "EU",
  R: "EU",
  S: "EU",
  U: "EU",
  V: "EU",
  X: "EU",
  Y: "EU",
  Z: "EU",
  J: "JP",
  K: "KR",
  Q: "KR",
  T: "KR",
  W: "ASIA",
};

const SKU_REGION_ORDER: SkuRegion[] = ["US", "EU", "JP", "KR", "ASIA"];

export const getSkuRegion = (sku: string): SkuRegion | null => {
  const normalizedSku = sku.trim().toUpperCase();
  const sonyRegion = SONY_SKU_REGION_MAP[normalizedSku.slice(0, 4)];
  if (sonyRegion) return sonyRegion;

  const pspMatch = PSP_DISC_ID_RE.exec(normalizedSku);
  if (pspMatch) return PSP_REGION_MAP[pspMatch[1]] ?? null;

  if (DOLPHIN_GAME_ID_RE.test(normalizedSku)) {
    return DOLPHIN_REGION_MAP[normalizedSku[3]] ?? null;
  }

  return null;
};

export const getSkuRegionFromSaveIdentity = (
  saveIdentity: string | null | undefined
): SkuRegion | null => {
  if (!saveIdentity) return null;
  const cleaned = saveIdentity
    .trim()
    .toUpperCase()
    .replace(/^B[A-Z](?=[A-Z]{4}[-_ .]?\d{5})/, "");
  return getSkuRegion(cleaned);
};

export const getRegionsFromSkus = (skus: string[]): SkuRegion[] => {
  const set = new Set<SkuRegion>();
  for (const sku of skus) {
    const region = getSkuRegion(sku);
    if (region) set.add(region);
  }
  return SKU_REGION_ORDER.filter((region) => set.has(region));
};
