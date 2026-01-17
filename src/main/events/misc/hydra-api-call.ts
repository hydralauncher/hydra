import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

interface HydraApiCallPayload {
  method: "get" | "post" | "put" | "patch" | "delete";
  url: string;
  data?: unknown;
  params?: unknown;
  options?: {
    needsAuth?: boolean;
    needsSubscription?: boolean;
    ifModifiedSince?: Date;
  };
}

const hydraApiCall = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: HydraApiCallPayload
) => {
  const { method, url, data, params, options } = payload;

  switch (method) {
    case "get":
      return HydraApi.get(url, params, options);
    case "post":
      return HydraApi.post(url, data, options);
    case "put":
      return HydraApi.put(url, data, options);
    case "patch":
      return HydraApi.patch(url, data, options);
    case "delete":
      return HydraApi.delete(url, options);
    default:
      throw new Error(`Unsupported HTTP method: ${method}`);
  }
};

registerEvent("hydraApiCall", hydraApiCall);
