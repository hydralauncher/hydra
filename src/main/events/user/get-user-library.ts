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
    params.append('take', take.toString());
  }
  
  if (skip !== undefined) {
    params.append('skip', skip.toString());
  }
  
  const queryString = params.toString();
  const url = `/users/${userId}/library${queryString ? `?${queryString}` : ''}`;
  
  return HydraApi.get<UserLibraryResponse>(url).catch(() => null);
};

registerEvent("getUserLibrary", getUserLibrary);