import { Button } from "../../components";
import { IS_DESKTOP } from "../../constants";
import { useNavigate } from "react-router-dom";

export default function Settings() {
  const navigate = useNavigate();

  const handleCloseBigPicture = () => {
    if (IS_DESKTOP) {
      globalThis.close();
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
      <Button onClick={handleCloseBigPicture}>Close big picture</Button>
    </div>
  );
}
