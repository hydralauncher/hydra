import type {
  GameContentWarning,
  GameContentWarningLevel,
  GameContentWarningReason,
} from "@types";
import { SteamContentDescriptor } from "./constants.js";

const ADULT_MINIMUM_AGE = 18;
const MATURE_MINIMUM_AGE = 17;

const CONTENT_WARNING_REASON_ORDER: GameContentWarningReason[] = [
  "age_restricted",
  "nudity",
  "sexual_content",
];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getPositiveInteger = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getDescriptorIds = (contentDescriptors: Record<string, unknown> | null) =>
  new Set(
    Array.isArray(contentDescriptors?.ids)
      ? contentDescriptors.ids.filter(
          (id): id is number => typeof id === "number"
        )
      : []
  );

const getSteamReasons = (
  descriptorIds: Set<number>,
  descriptorNotes: string
) => {
  const reasons = new Set<GameContentWarningReason>();
  const hasCombinedSexualDescriptor =
    descriptorIds.has(SteamContentDescriptor.SomeNudityOrSexualContent) ||
    descriptorIds.has(SteamContentDescriptor.FrequentNudityOrSexualContent);

  if (hasCombinedSexualDescriptor || /\bnud(?:e|ity)\b/.test(descriptorNotes)) {
    reasons.add("nudity");
  }

  if (
    hasCombinedSexualDescriptor ||
    descriptorIds.has(SteamContentDescriptor.AdultOnlySexualContent) ||
    /\bsex(?:ual|ually)?\b/.test(descriptorNotes)
  ) {
    reasons.add("sexual_content");
  }

  return reasons;
};

const getSteamLevel = (
  minimumAge: number | null,
  reasons: Set<GameContentWarningReason>,
  descriptorIds: Set<number>
): GameContentWarningLevel => {
  if (minimumAge !== null && minimumAge >= ADULT_MINIMUM_AGE) return "adult";

  const isMature =
    (minimumAge !== null && minimumAge >= MATURE_MINIMUM_AGE) ||
    reasons.has("nudity") ||
    reasons.has("sexual_content") ||
    descriptorIds.has(SteamContentDescriptor.GeneralMatureContent);

  return isMature ? "mature" : "none";
};

export const buildSteamContentWarning = (
  details: unknown
): GameContentWarning | null => {
  const data = asRecord(details);
  if (!data) return null;

  const contentDescriptors = asRecord(data.content_descriptors);
  const descriptorIds = getDescriptorIds(contentDescriptors);
  const descriptorNotes =
    typeof contentDescriptors?.notes === "string"
      ? contentDescriptors.notes.toLowerCase()
      : "";
  const reasons = getSteamReasons(descriptorIds, descriptorNotes);

  const requiredAge = getPositiveInteger(data.required_age);
  const hasAdultOnlyDescriptor =
    descriptorIds.has(SteamContentDescriptor.AdultOnlySexualContent) ||
    descriptorIds.has(SteamContentDescriptor.FrequentNudityOrSexualContent);
  const minimumAge = hasAdultOnlyDescriptor
    ? Math.max(requiredAge ?? 0, ADULT_MINIMUM_AGE)
    : requiredAge;

  if (minimumAge !== null && minimumAge >= MATURE_MINIMUM_AGE) {
    reasons.add("age_restricted");
  }

  return {
    level: getSteamLevel(minimumAge, reasons, descriptorIds),
    minimumAge,
    reasons: CONTENT_WARNING_REASON_ORDER.filter((reason) =>
      reasons.has(reason)
    ),
    source: "steam",
  };
};

export const isAdultGameContentWarning = (
  warning: GameContentWarning | null | undefined
) => warning?.level === "adult";
