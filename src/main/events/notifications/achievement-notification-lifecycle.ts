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
