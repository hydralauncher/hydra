interface ActiveGameArtifactExport {
  senderId: number;
  controller: AbortController;
}

export class GameArtifactExportCoordinator {
  private activeExport: ActiveGameArtifactExport | null = null;

  start(senderId: number): AbortController | null {
    if (this.activeExport) return null;

    const controller = new AbortController();
    this.activeExport = { senderId, controller };
    return controller;
  }

  cancel(senderId: number): boolean {
    if (this.activeExport?.senderId !== senderId) {
      return false;
    }

    this.activeExport.controller.abort();
    return true;
  }

  finish(controller: AbortController): void {
    if (this.activeExport?.controller === controller) {
      this.activeExport = null;
    }
  }
}

export const gameArtifactExportCoordinator =
  new GameArtifactExportCoordinator();
