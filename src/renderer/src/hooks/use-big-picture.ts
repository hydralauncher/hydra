import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

export function useBigPicture() {
  const navigate = useNavigate();

  const enterBigPicture = useCallback(() => {
    window.electron.setFullScreen(true);
    navigate("/big-picture");
  }, [navigate]);

  const exitBigPicture = useCallback(() => {
    window.electron.setFullScreen(false);
    navigate("/");
  }, [navigate]);

  return { enterBigPicture, exitBigPicture };
}
