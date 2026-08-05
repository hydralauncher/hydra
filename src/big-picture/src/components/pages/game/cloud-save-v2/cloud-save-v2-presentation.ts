type CloudSavePanelAction =
  | {
      kind: "sync";
      labelKey: string;
      icon: "cloud" | "upload" | "restore";
    }
  | {
      kind: "details";
      labelKey: "cloud_save_v2_view_files";
      icon: "details";
    }
  | {
      kind: "confirm-location";
      labelKey: "cloud_save_v2_confirm_location";
      icon: "folder";
    }
  | {
      kind: "verify";
      labelKey: "cloud_save_v2_check_again";
      icon: "refresh";
    }
  | { kind: "conflict" }
  | { kind: "none" };

type CloudSavePresentationIcon =
  | "cloud"
  | "cloud-slash"
  | "cloud-x"
  | "spinner"
  | "upload"
  | "restore"
  | "folder"
  | "synced"
  | "warning";

export interface BigPictureCloudSaveAction {
  kind: "sync" | "conflict" | "none";
  labelKey?: string;
  icon?: CloudSavePresentationIcon;
}

export function getBigPictureCloudSaveAction(
  action: CloudSavePanelAction
): BigPictureCloudSaveAction {
  if (action.kind === "conflict") {
    return { kind: "conflict" };
  }

  if (action.kind === "none") {
    return { kind: "none" };
  }

  if (action.kind === "details") {
    return {
      kind: "sync",
      labelKey: "cloud_save_v2_check_again",
      icon: "spinner",
    };
  }

  if (action.kind === "confirm-location") {
    return {
      kind: "sync",
      labelKey: action.labelKey,
      icon: "folder",
    };
  }

  return {
    kind: "sync",
    labelKey: action.labelKey,
    icon:
      action.kind === "verify"
        ? "spinner"
        : action.icon === "upload"
          ? "upload"
          : action.icon === "restore"
            ? "restore"
            : "cloud",
  };
}
