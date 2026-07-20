import fs from "node:fs";
import path from "node:path";

import type { PathGrant } from "@types";
import {
  isDocPortalMountAvailable,
  isDocPortalPath,
  isFlatpak,
} from "@main/helpers/sandbox";
import { pathGrantsSublevel } from "@main/level";
import { NativeAddon } from "./native-addon";
import { logger } from "./logger";

const HOST_PATH_XATTR = "user.document-portal.host-path";

export class PathGrants {
  /**
   * Records a (accessPath → displayPath) mapping for a user-picked path.
   * Outside Flatpak, or for paths covered by static permissions, this is a
   * no-op and the path is returned unchanged as both access and display path.
   */
  public static async annotate(accessPath: string): Promise<PathGrant> {
    if (!isFlatpak || !isDocPortalPath(accessPath)) {
      return {
        accessPath,
        displayPath: accessPath,
        createdAt: Date.now(),
      };
    }

    const grant: PathGrant = {
      accessPath,
      displayPath: this.resolveHostPath(accessPath),
      createdAt: Date.now(),
    };

    await pathGrantsSublevel.put(accessPath, grant).catch((error) => {
      logger.error("Failed to persist path grant", error);
    });

    return grant;
  }

  public static async getDisplayPath(accessPath: string): Promise<string> {
    if (!isFlatpak || !isDocPortalPath(accessPath)) return accessPath;

    const grant = await pathGrantsSublevel
      .get(accessPath)
      .catch(() => null as PathGrant | null);

    if (grant?.displayPath) return grant.displayPath;

    return this.resolveHostPath(accessPath);
  }

  /**
   * Checks whether the sandbox can still reach `accessPath`. Defaults to a
   * read check; pass `fs.constants.W_OK` for download targets, where what
   * actually matters is whether we can still write into the folder.
   */
  public static async verifyAccess(
    accessPath: string,
    mode: number = fs.constants.R_OK
  ): Promise<boolean> {
    try {
      await fs.promises.access(accessPath, mode);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the persisted grants whose access paths are no longer reachable
   * (revoked grant, reset portal database, or missing doc mount).
   *
   * Used by startup recovery (see `notifyLostPathGrants` in main.ts) to surface
   * lost wine-prefix, proton, and game-executable portal grants, alongside the
   * download paths handled directly via `hasLostPathGrant`.
   *
   * Broken grants are pruned as they are found: a doc-portal id only lapses
   * once, so surfacing it a single time (and dropping it) avoids the same
   * stale grant re-toasting on every subsequent launch. Grants in
   * `skipAccessPaths` are still reported as broken but are left in place —
   * the caller is already handling them (e.g. a paused download) and they
   * get re-annotated whenever preferences are saved, so pruning them here
   * would just strand the next launch's `getDisplayPath` lookup.
   */
  public static async listBroken(
    skipAccessPaths: Set<string> = new Set()
  ): Promise<PathGrant[]> {
    if (!isFlatpak) return [];

    // If the document mount itself is gone (e.g. portal restarted after
    // suspend), every grant would look broken — callers should treat this
    // as a session problem, not as revoked grants.
    if (!isDocPortalMountAvailable()) return [];

    const broken: PathGrant[] = [];

    for await (const grant of pathGrantsSublevel.values()) {
      if (!(await this.verifyAccess(grant.accessPath))) {
        broken.push(grant);
        if (!skipAccessPaths.has(grant.accessPath)) {
          await this.removeGrant(grant.accessPath);
        }
      }
    }

    return broken;
  }

  public static async removeGrant(accessPath: string) {
    await pathGrantsSublevel.del(accessPath).catch(() => {});
  }

  /**
   * Resolves the real host path of a document-portal path via the
   * user.document-portal.host-path xattr the portal sets on exported
   * documents. Falls back to the path itself.
   */
  private static resolveHostPath(accessPath: string): string {
    const hostPath = NativeAddon.getXattr(accessPath, HOST_PATH_XATTR);
    if (hostPath) return hostPath;

    // The xattr lives on the exported document root; a picked file may be
    // one level below it (.../doc/<id>/<name>).
    const parent = path.dirname(accessPath);
    const parentHostPath = NativeAddon.getXattr(parent, HOST_PATH_XATTR);
    if (parentHostPath) {
      return path.join(parentHostPath, path.basename(accessPath));
    }

    return accessPath;
  }
}
