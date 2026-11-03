import { achievementNotificationPresenter } from "@main/services";
import { registerEvent } from "../register-event";

registerEvent("achievementNotificationHostReady", (event) => {
  achievementNotificationPresenter.handleRendererEvent(event.sender.id, {
    type: "host-ready",
  });
});

registerEvent(
  "achievementNotificationContentReady",
  (event, requestId: string) => {
    achievementNotificationPresenter.handleRendererEvent(event.sender.id, {
      type: "content-ready",
      requestId,
    });
  }
);

registerEvent("achievementNotificationStarted", (event, requestId: string) => {
  achievementNotificationPresenter.handleRendererEvent(event.sender.id, {
    type: "started",
    requestId,
  });
});

registerEvent(
  "achievementNotificationSoundPlayed",
  (event, batchId: string) => {
    achievementNotificationPresenter.handleRendererEvent(event.sender.id, {
      type: "sound-played",
      batchId,
    });
  }
);

registerEvent("achievementNotificationFinished", (event, requestId: string) => {
  achievementNotificationPresenter.handleRendererEvent(event.sender.id, {
    type: "finished",
    requestId,
  });
});

registerEvent(
  "achievementNotificationFailed",
  (event, requestId?: string, reason?: string) => {
    achievementNotificationPresenter.handleRendererEvent(event.sender.id, {
      type: "failed",
      requestId,
      reason,
    });
  }
);
