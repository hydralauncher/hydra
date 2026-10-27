import UserAgent from "user-agents";

let browserUserAgent: string | null = null;

export const getBrowserUserAgent = () => {
  browserUserAgent ??= new UserAgent({ deviceCategory: "desktop" }).toString();
  return browserUserAgent;
};
