export interface SystemSpecs {
  /** Installed RAM reported by the OS, in bytes. */
  totalMemoryBytes: number;
  /** Free space on the drive the check is made against, in bytes. */
  freeStorageBytes: number | null;
}

export interface ParsedRequirementSizes {
  memoryBytes: number | null;
  storageBytes: number | null;
}

export interface RequirementMismatch {
  kind: "memory" | "storage";
  requiredBytes: number;
  availableBytes: number;
}

const UNIT_BYTES: Record<string, number> = {
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

const SIZE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(MB|GB|TB)\b/i;
const MEMORY_LABEL = /\b(memory|ram)\b/i;
const NON_SYSTEM_MEMORY_LABEL = /video|graphics|gpu|vram/i;
const STORAGE_LABEL =
  /storage|hard\s*(drive|disk)|disk\s*space|free\s*space|available\s*space/i;

// Installed RAM and disks report slightly less than the marketing size
// (e.g. 8 GB of RAM shows up as ~7.7 GiB), so memory only counts as too
// small when it is clearly below the requirement.
const MEMORY_TOLERANCE = 0.95;

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * Converts requirement HTML (Steam/Epic style lists) into one plain-text line
 * per requirement row.
 */
export function requirementHtmlToLines(html: string): string[] {
  return html
    .replace(/<br\s*\/?>|<\/?(li|p|div|tr|h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity] ?? entity)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Extracts the RAM and storage requirements from a requirement block.
 * Only the first matching row of each kind is used, and video/graphics memory
 * rows are ignored so they are not mistaken for system RAM.
 */
export function parseRequirementSizes(html: string): ParsedRequirementSizes {
  let memoryBytes: number | null = null;
  let storageBytes: number | null = null;

  for (const line of requirementHtmlToLines(html)) {
    const match = SIZE_PATTERN.exec(line);
    if (!match) continue;

    const amount = Number.parseFloat(match[1].replace(",", "."));
    const unit = UNIT_BYTES[match[2].toLowerCase()];
    if (!Number.isFinite(amount) || !unit) continue;

    const bytes = amount * unit;
    const label = line.slice(0, match.index);

    if (
      memoryBytes === null &&
      MEMORY_LABEL.test(label) &&
      !NON_SYSTEM_MEMORY_LABEL.test(label)
    ) {
      memoryBytes = bytes;
    } else if (storageBytes === null && STORAGE_LABEL.test(label)) {
      storageBytes = bytes;
    }
  }

  return { memoryBytes, storageBytes };
}

export function findRequirementMismatches(
  requirements: ParsedRequirementSizes,
  specs: SystemSpecs
): RequirementMismatch[] {
  const mismatches: RequirementMismatch[] = [];

  if (
    requirements.memoryBytes !== null &&
    specs.totalMemoryBytes > 0 &&
    specs.totalMemoryBytes < requirements.memoryBytes * MEMORY_TOLERANCE
  ) {
    mismatches.push({
      kind: "memory",
      requiredBytes: requirements.memoryBytes,
      availableBytes: specs.totalMemoryBytes,
    });
  }

  if (
    requirements.storageBytes !== null &&
    specs.freeStorageBytes !== null &&
    specs.freeStorageBytes < requirements.storageBytes
  ) {
    mismatches.push({
      kind: "storage",
      requiredBytes: requirements.storageBytes,
      availableBytes: specs.freeStorageBytes,
    });
  }

  return mismatches;
}
