import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { UserLibraryResponse } from "@types";

const getUserLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string,
  take: number = 12,
  skip: number = 0,
  sortBy?: string
): Promise<UserLibraryResponse | null> => {
  const params = new URLSearchParams();

  params.append("take", take.toString());
  params.append("skip", skip.toString());

  if (sortBy) {
    params.append("sortBy", sortBy);
  }

  const queryString = params.toString();
  const baseUrl = `/users/${userId}/library`;
  const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;

  return HydraApi.get<UserLibraryResponse>(url).catch(() => null);
};

registerEvent("getUserLibrary", getUserLibrary);
