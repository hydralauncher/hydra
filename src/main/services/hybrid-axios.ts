import axios from "axios";
import { createHybridAdapter } from "./hydra-hybrid-adapter";

// Any main-process code that historically did `axios.put(presignedUrl, ...)`
// where `presignedUrl` was a Hydra-minted URL now needs the hybrid adapter,
// otherwise the request bypasses the interceptor and tries to hit the real
// (or a nonexistent) presigned endpoint. Importing this instance instead of
// raw axios keeps the hijack transparent.
export const hybridAxios = axios.create();
hybridAxios.defaults.adapter = createHybridAdapter(
  hybridAxios.defaults.adapter as any
);
