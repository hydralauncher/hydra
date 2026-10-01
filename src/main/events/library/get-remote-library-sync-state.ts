import { isRemoteLibrarySyncing } from "@main/services/library-sync/remote-library-sync-state";

import { registerEvent } from "../register-event";

const getRemoteLibrarySyncState = async () => isRemoteLibrarySyncing();

registerEvent("getRemoteLibrarySyncState", getRemoteLibrarySyncState);
