import { SystemPath } from "@main/services/system-path";
import type {
  CloudSaveCustomPath,
  CloudSaveCustomPathBindings,
  CloudSaveRule,
  GameShop,
  RestoreManifestFile,
} from "@types";

import { NativeAddon } from "../native-addon";
import type { getCloudSaveGameContext } from "./cloud-save-game-context";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import { getCloudSaveCustomPathOverlapErrorCode } from "./custom-path-overlap-error";
import {
  partitionCloudSaveCustomPathBindingsByOverlap,
  type CloudSaveCustomPathOverlapChecker,
} from "./custom-path-overlap-bindings";
import {
  customPathToCloudSaveRule,
  getCloudSaveCustomPathBindings,
  registerCloudSaveCustomPaths,
} from "./custom-path-store";

type CloudSaveGameContext = Awaited<ReturnType<typeof getCloudSaveGameContext>>;

interface GetUsableCloudSaveCustomPathBindingsOptions {
  approvedRules?: CloudSaveRule[];
  remoteFiles?: RestoreManifestFile[];
  bindings?: CloudSaveCustomPathBindings;
}

const checkOverlap: CloudSaveCustomPathOverlapChecker = ({
  objectId,
  shop,
  selectedPath,
  pathContext,
  approvedRules,
  customPaths,
  currentRawPath,
  remoteRelativePaths = [],
}) =>
  NativeAddon.checkCloudSaveCustomPathOverlap({
    shop,
    objectId,
    platform: pathContext.platform,
    homeDir: pathContext.homeDir,
    documentsDir: pathContext.documentsDir,
    appDataDir: pathContext.appDataDir,
    executablePath: pathContext.executablePath,
    winePrefixPath: pathContext.winePrefixPath,
    steamPath: pathContext.steamPath,
    rules: [
      ...approvedRules,
      ...customPaths
        .filter(({ rawPath }) => rawPath !== currentRawPath)
        .map(customPathToCloudSaveRule),
    ],
    selectedPath,
    remoteRelativePaths,
  });

export const getApprovedCloudSaveRules = async (
  objectId: string,
  shop: GameShop,
  context: CloudSaveGameContext
) =>
  (
    await NativeAddon.getSaveRulesForGame({
      shop,
      objectId,
      title: context.game?.title,
      remoteId: context.game?.remoteId ?? undefined,
      userDataPath: SystemPath.getPath("userData"),
    })
  ).rules;

export const assertCloudSaveCustomPathDoesNotOverlap = async ({
  objectId,
  shop,
  selectedPath,
  context,
  currentRawPath,
  remoteRelativePaths = [],
  approvedRules,
}: {
  objectId: string;
  shop: GameShop;
  selectedPath: string;
  context: CloudSaveGameContext;
  currentRawPath?: string;
  remoteRelativePaths?: string[];
  approvedRules?: CloudSaveRule[];
}) => {
  const bindings = await getCloudSaveCustomPathBindings(
    shop,
    objectId,
    cloudSaveCustomPathContextFromPathContext(context.pathContext)
  );
  const resolvedApprovedRules =
    approvedRules ?? (await getApprovedCloudSaveRules(objectId, shop, context));
  const result = checkOverlap({
    objectId,
    shop,
    selectedPath,
    pathContext: context.pathContext,
    approvedRules: resolvedApprovedRules,
    customPaths: bindings.ready,
    currentRawPath,
    remoteRelativePaths,
  });

  if (result.hasOverlap) {
    throw new Error(getCloudSaveCustomPathOverlapErrorCode(result.reason));
  }
};

export const registerCloudSaveCustomPathWithoutOverlap = async ({
  objectId,
  shop,
  customPath,
  context,
  currentRawPath,
  remoteRelativePaths = [],
  assertCanRegister,
  syncState = "confirmed",
}: {
  objectId: string;
  shop: GameShop;
  customPath: CloudSaveCustomPath;
  context: CloudSaveGameContext;
  currentRawPath?: string;
  remoteRelativePaths?: string[];
  assertCanRegister?: () => void;
  syncState?: "pending" | "confirmed";
}) => {
  const approvedRules = await getApprovedCloudSaveRules(
    objectId,
    shop,
    context
  );
  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    context.pathContext
  );
  await registerCloudSaveCustomPaths(shop, objectId, [customPath], {
    context: customPathContext,
    syncState,
    assertCurrentBindings: (bindings) => {
      assertCanRegister?.();
      const result = checkOverlap({
        objectId,
        shop,
        selectedPath: customPath.path,
        pathContext: context.pathContext,
        approvedRules,
        customPaths: bindings.ready,
        currentRawPath,
        remoteRelativePaths,
      });
      if (result.hasOverlap) {
        throw new Error(getCloudSaveCustomPathOverlapErrorCode(result.reason));
      }
      assertCanRegister?.();
    },
  });
};

export const getUsableCloudSaveCustomPathBindings = async (
  objectId: string,
  shop: GameShop,
  context: CloudSaveGameContext,
  options: GetUsableCloudSaveCustomPathBindingsOptions = {}
): Promise<CloudSaveCustomPathBindings> => {
  const bindings =
    options.bindings ??
    (await getCloudSaveCustomPathBindings(
      shop,
      objectId,
      cloudSaveCustomPathContextFromPathContext(context.pathContext)
    ));
  if (bindings.ready.length === 0) return bindings;

  const approvedRules =
    options.approvedRules ??
    (await getApprovedCloudSaveRules(objectId, shop, context));
  return partitionCloudSaveCustomPathBindingsByOverlap(
    {
      objectId,
      shop,
      pathContext: context.pathContext,
      bindings,
      approvedRules,
      remoteFiles: options.remoteFiles ?? [],
    },
    checkOverlap
  );
};
