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

  const getErrorMessage = (error: unknown): string | null => {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === "object" && error !== null) {
      const response = (
        error as { response?: { data?: { message?: unknown } } }
      ).response;
      const responseMessage = response?.data?.message;

      if (typeof responseMessage === "string") {
        return responseMessage;
      }
    }

    return null;
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
    throw new Error(errorMessage ?? "hydra-api-call-failed");
  }
};

registerEvent("hydraApiCall", hydraApiCall);
