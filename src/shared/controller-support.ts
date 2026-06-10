export type ControllerSupportStatus = "full" | "partial" | "none";

export interface ControllerSupportDetails {
  controller_support?: "full" | "partial";
  categories?: { id: number }[];
}

export interface ControllerSupportCopyKeys {
  labelKey:
    | "controller_support_full_label"
    | "controller_support_partial_label"
    | "controller_support_none_label";
  descriptionKey?:
    | "controller_support_full_description"
    | "controller_support_partial_description";
}

const FULL_SUPPORT_CATEGORY_ID = 28;
const PARTIAL_SUPPORT_CATEGORY_ID = 18;

export function resolveControllerSupport(
  details: ControllerSupportDetails
): ControllerSupportStatus {
  if (details.controller_support === "full") {
    return "full";
  }

  if (details.controller_support === "partial") {
    return "partial";
  }

  const categories = details.categories ?? [];

  if (categories.some(({ id }) => id === FULL_SUPPORT_CATEGORY_ID)) {
    return "full";
  }

  if (categories.some(({ id }) => id === PARTIAL_SUPPORT_CATEGORY_ID)) {
    return "partial";
  }

  return "none";
}

export function getControllerSupportCopyKeys(
  status: ControllerSupportStatus
): ControllerSupportCopyKeys {
  switch (status) {
    case "full":
      return {
        labelKey: "controller_support_full_label",
        descriptionKey: "controller_support_full_description",
      };
    case "partial":
      return {
        labelKey: "controller_support_partial_label",
        descriptionKey: "controller_support_partial_description",
      };
    default:
      return {
        labelKey: "controller_support_none_label",
      };
  }
}
