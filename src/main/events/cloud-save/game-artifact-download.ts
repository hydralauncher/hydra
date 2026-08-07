import { HydraApi } from "@main/services";

export interface GameArtifactDownload {
  downloadUrl: string;
  objectKey: string;
  homeDir: string;
  winePrefixPath: string | null;
}

export const requestGameArtifactDownload = (
  gameArtifactId: string
): Promise<GameArtifactDownload> =>
  HydraApi.post<GameArtifactDownload>(
    `/profile/games/artifacts/${gameArtifactId}/download`
  );
