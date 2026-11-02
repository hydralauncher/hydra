import { useEffect } from "react";

const FEEDBACK_WIDGET_HIDDEN_CLASS = "feedback-widget-hidden";

let hiddenRequestCount = 0;

export function useFeedbackWidgetHidden() {
  useEffect(() => {
    hiddenRequestCount += 1;
    document.body.classList.add(FEEDBACK_WIDGET_HIDDEN_CLASS);

    return () => {
      hiddenRequestCount -= 1;
      if (hiddenRequestCount === 0) {
        document.body.classList.remove(FEEDBACK_WIDGET_HIDDEN_CLASS);
      }
    };
  }, []);
}
