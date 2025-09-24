import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { UserLibraryResponse } from "@types";

const getUserLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string,
  take?: number,
  skip?: number
): Promise<UserLibraryResponse | null> => {
  const params = new URLSearchParams();

  if (take !== undefined) {
    params.append("take", take.toString());
  }

  if (skip !== undefined) {
    params.append("skip", skip.toString());
  }

  const queryString = params.toString();
  const baseUrl = `/users/${userId}/library`;
  const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;

  return HydraApi.get<UserLibraryResponse>(url).catch(() => null);
};

registerEvent("getUserLibrary", getUserLibrary);
