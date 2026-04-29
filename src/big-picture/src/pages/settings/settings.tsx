import { Button } from "../../components";
import { IS_DESKTOP } from "../../constants";
import { useNavigate } from "react-router-dom";

export default function Settings() {
  const navigate = useNavigate();

  const handleOpenMainWindow = () => {
    if (IS_DESKTOP) {
      void globalThis.window.electron.openMainWindow();
    } else {
      navigate("/");
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Button onClick={handleOpenMainWindow}>Open main window</Button>
    </div>
  );
}
