export async function fetchSteamSpyTopTags(
  objectId: string
): Promise<string[]> {
  try {
    const res = await fetch(
      `https://steamspy.com/api.php?request=appdetails&appid=${encodeURIComponent(
        objectId
      )}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { tags?: Record<string, number> };
    const tags = data?.tags;
    if (!tags || typeof tags !== "object") return [];
    return Object.entries(tags)
      .map(([name, votes]) => [name, Number(votes)] as const)
      .filter(([, v]) => Number.isFinite(v) && v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([n]) => n);
  } catch {
    return [];
  }
}
