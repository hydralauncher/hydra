import { create } from "zustand";

interface ScreenshotLikesInFlightState {
  ids: ReadonlySet<string>;
}

export const useScreenshotLikesInFlight = create<ScreenshotLikesInFlightState>(
  () => ({ ids: new Set<string>() })
);

export const claimScreenshotLike = (screenshotId: string) => {
  const { ids } = useScreenshotLikesInFlight.getState();
  if (ids.has(screenshotId)) return false;

  useScreenshotLikesInFlight.setState({
    ids: new Set(ids).add(screenshotId),
  });
  return true;
};

export const releaseScreenshotLike = (screenshotId: string) => {
  const ids = new Set(useScreenshotLikesInFlight.getState().ids);
  ids.delete(screenshotId);
  useScreenshotLikesInFlight.setState({ ids });
};
