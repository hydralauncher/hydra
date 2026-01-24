import { useGamepadContext } from "../../context/gamepad";
import "./controller-indicator.scss";

/**
 * Visual indicator that shows when controller mode is active.
 * Displays in the corner of the screen with the current controller name.
 */
export function ControllerIndicator() {
    const { isControllerMode, activeGamepad } = useGamepadContext();

    if (!isControllerMode) {
        return null;
    }

    const controllerName = activeGamepad?.id?.split("(")[0]?.trim() || "Controller";

    return (
        <div className="controller-indicator">
            <svg viewBox="0 0 24 24" className="controller-indicator__icon">
                <path d="M7.97 16L5 19c-.36.36-.36.94 0 1.3.36.38.94.38 1.3 0L9.26 17h5.48l2.96 3.3c.36.36.94.36 1.3 0 .36-.36.36-.94 0-1.3L16.03 16C18.12 16 20 14.21 20 12V8c0-2.21-1.79-4-4-4H8C5.79 4 4 5.79 4 8v4c0 2.21 1.91 4 3.97 4zM8 6h8c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2V8c0-1.1.9-2 2-2z" />
                <circle cx="9" cy="10" r="1.5" />
                <circle cx="15" cy="10" r="1.5" />
            </svg>
            <span className="controller-indicator__text">{controllerName}</span>
        </div>
    );
}
