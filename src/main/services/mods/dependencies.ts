import type { ThunderstorePackage } from "../../../types/mods.types";

export interface ParsedDependency {
  owner: string;
  name: string;
  version: string;
  fullName: string;
}

/** "Owner-Name-1.2.3" -> parts. Owner has no dashes; version has none either. */
export const parseDependency = (dep: string): ParsedDependency | null => {
  const first = dep.indexOf("-");
  const last = dep.lastIndexOf("-");
  if (first <= 0 || last <= first) return null;
  const owner = dep.slice(0, first);
  const name = dep.slice(first + 1, last);
  const version = dep.slice(last + 1);
  if (!owner || !name || !/^\d+(\.\d+)*/.test(version)) return null;
  return { owner, name, version, fullName: `${owner}-${name}` };
};

export const compareVersions = (a: string, b: string): number => {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
};

export interface PlannedInstall {
  fullName: string;
  version: string;
  downloadUrl: string;
  isDependency: boolean;
}

export interface ResolveResult {
  /** Dependencies first, requested package last. */
  plan: PlannedInstall[];
  missing: string[];
}

/**
 * Resolves what must be installed for `rootFullName`.
 * - A dependency already installed at >= the required version is kept.
 * - Otherwise the newest indexed version is used (always >= the required one).
 * - Cycle-safe; unknown packages are reported in `missing`.
 */
export const resolveInstallPlan = (
  rootFullName: string,
  index: Map<string, ThunderstorePackage>,
  installed: Record<string, { version: string }>,
  rootVersion?: string
): ResolveResult => {
  const plan: PlannedInstall[] = [];
  const missing: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  const visit = (
    fullName: string,
    minVersion: string | undefined,
    isDependency: boolean
  ) => {
    if (done.has(fullName) || visiting.has(fullName)) return;

    const pkg = index.get(fullName);
    if (!pkg || pkg.versions.length === 0) {
      if (!missing.includes(fullName)) missing.push(fullName);
      return;
    }

    const current = installed[fullName]?.version;
    const alreadyOk =
      isDependency &&
      current !== undefined &&
      (!minVersion || compareVersions(current, minVersion) >= 0);
    if (alreadyOk) {
      done.add(fullName);
      return;
    }

    const target =
      (!isDependency && rootVersion
        ? pkg.versions.find((v) => v.version === rootVersion)
        : undefined) ?? pkg.versions[0];

    visiting.add(fullName);
    for (const raw of target.dependencies) {
      const dep = parseDependency(raw);
      if (!dep) continue;
      visit(dep.fullName, dep.version, true);
    }
    visiting.delete(fullName);

    done.add(fullName);
    plan.push({
      fullName,
      version: target.version,
      downloadUrl: target.downloadUrl,
      isDependency,
    });
  };

  visit(rootFullName, undefined, false);
  return { plan, missing };
};

/** Installed mods that nothing else installed depends on (for safe cleanup). */
export const findOrphanedDependencies = (
  installed: Record<string, { isDependency: boolean }>,
  index: Map<string, ThunderstorePackage>,
  installedVersions: Record<string, string>
): string[] => {
  const needed = new Set<string>();
  for (const [fullName, mod] of Object.entries(installed)) {
    if (mod.isDependency) continue;
    const stack = [fullName];
    while (stack.length) {
      const cur = stack.pop()!;
      if (needed.has(cur)) continue;
      needed.add(cur);
      const pkg = index.get(cur);
      const version =
        pkg?.versions.find((v) => v.version === installedVersions[cur]) ??
        pkg?.versions[0];
      for (const raw of version?.dependencies ?? []) {
        const dep = parseDependency(raw);
        if (dep && installed[dep.fullName]) stack.push(dep.fullName);
      }
    }
  }
  return Object.keys(installed).filter((n) => !needed.has(n));
};
