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

  const getErrorStatus = (error: unknown): number | undefined => {
    if (typeof error === "object" && error !== null) {
      const response = (error as { response?: { status?: unknown } }).response;

      if (typeof response?.status === "number") {
        return response.status;
      }
    }

    return undefined;
  };

  try {
    let request: Promise<unknown>;

    switch (method) {
      case "get":
        request = HydraApi.get(url, params, options);
        break;
      case "post":
        request = HydraApi.post(url, data, options);
        break;
      case "put":
        request = HydraApi.put(url, data, options);
        break;
      case "patch":
        request = HydraApi.patch(url, data, options);
        break;
      case "delete":
        request = HydraApi.delete(url, options);
        break;
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }

    return await request;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const status = getErrorStatus(error);

    throw Object.assign(new Error(errorMessage ?? "hydra-api-call-failed"), {
      status,
    });
  }

registerEvent("hydraApiCall", hydraApiCall);
