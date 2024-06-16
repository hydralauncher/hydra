import { UserAuth } from "@types";

export interface UserAuthContext {
  userAuth: UserAuth | null;
  isLoading: boolean;
  updateMe: () => Promise<void>;
  signout: () => Promise<void>;
}
