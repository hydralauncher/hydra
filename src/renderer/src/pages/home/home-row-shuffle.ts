export type HomeRowCategory =
  | "discovery"
  | "curated"
  | "personal"
  | "genre"
  | "tag"
  | "classics-platform"
  | "classics-genre"
  | "spotlight";

export interface HomeRowSpec {
  id: string;
  category: HomeRowCategory;
  isVertical?: boolean;
  platform?: "ps1" | "ps2" | "ps3";
}

export const makeRng = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const fisherYates = <T>(arr: T[], rng: () => number): T[] => {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export function shuffleWithSeparation<T extends HomeRowSpec>(
  rows: T[],
  sessionSeed: number,
  options: { classicsPlatformGap?: number } = {}
): T[] {
  const classicsPlatformGap = options.classicsPlatformGap ?? 2;
  const rng = makeRng(sessionSeed);
  const queue = fisherYates(rows, rng);
  const out: T[] = [];

  const themeFamily = (cat: HomeRowCategory): "theme" | HomeRowCategory => {
    if (cat === "genre" || cat === "tag" || cat === "classics-genre") {
      return "theme";
    }
    return cat;
  };

  const isViolation = (candidate: T, list: T[]): boolean => {
    if (list.length === 0) return false;
    const prev = list[list.length - 1];
    const samePair =
      (candidate.category === "genre" && prev.category === "genre") ||
      (candidate.category === "tag" && prev.category === "tag") ||
      (candidate.category === "classics-genre" &&
        prev.category === "classics-genre");
    if (samePair) return true;
    if (
      themeFamily(candidate.category) === "theme" &&
      themeFamily(prev.category) === "theme"
    ) {
      return true;
    }
    if (candidate.isVertical && prev.isVertical) return true;
    if (
      candidate.platform &&
      prev.platform &&
      candidate.platform === prev.platform
    ) {
      return true;
    }
    if (candidate.category === "classics-platform") {
      const lookBack = list.slice(-classicsPlatformGap);
      if (lookBack.some((r) => r.category === "classics-platform")) {
        return true;
      }
    }
    return false;
  };

  while (queue.length > 0) {
    let pickIdx = -1;
    for (let i = 0; i < queue.length; i++) {
      if (!isViolation(queue[i], out)) {
        pickIdx = i;
        break;
      }
    }
    if (pickIdx === -1) pickIdx = 0;
    const [picked] = queue.splice(pickIdx, 1);
    out.push(picked);
  }

  return out;
}
