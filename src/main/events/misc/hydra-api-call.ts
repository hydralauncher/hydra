import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

interface HydraApiCallPayload {
  method: "get" | "post" | "postResponse" | "put" | "patch" | "delete";
  url: string;
  data?: unknown;
  params?: unknown;
  options?: {
    needsAuth?: boolean;
    needsSubscription?: boolean;
    ifModifiedSince?: Date;
    acceptedStatuses?: number[];
  };
}

const hydraApiCall = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: HydraApiCallPayload
) => {
  const { method, url, data, params, options } = payload;
  const hydraApiOptions = {
    ...options,
    validateStatus: options?.acceptedStatuses
      ? (status: number) =>
          status !== 401 &&
          (options.acceptedStatuses?.includes(status) ?? false)
      : undefined,
  };

  const getErrorMessage = (error: unknown): string | null => {
    if (typeof error === "object" && error !== null) {
      const response = (
        error as { response?: { data?: { message?: unknown } } }
      ).response;
      const responseMessage = response?.data?.message;

      if (typeof responseMessage === "string") {
        return responseMessage;
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return null;
  };

  try {
    let request: Promise<unknown>;

    switch (method) {
      case "get":
        request = HydraApi.get(url, params, hydraApiOptions);
        break;
      case "post":
        request = HydraApi.post(url, data, hydraApiOptions);
        break;
      case "postResponse":
        request = HydraApi.postResponse(url, data, hydraApiOptions);
        break;
      case "put":
        request = HydraApi.put(url, data, hydraApiOptions);
        break;
      case "patch":
        request = HydraApi.patch(url, data, hydraApiOptions);
        break;
      case "delete":
        request = HydraApi.delete(url, hydraApiOptions);
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
