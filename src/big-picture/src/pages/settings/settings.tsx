import { IS_DESKTOP } from "../../constants";
import { useNavigate } from "react-router-dom";

export default function Settings() {
  const navigate = useNavigate();

  const handleCloseBigPicture = () => {
    if (IS_DESKTOP) {
      window.close();
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
      <button
        onClick={handleCloseBigPicture}
        style={{
          backgroundColor: "red",
          color: "white",
          padding: "10px 20px",
          borderRadius: "5px",
          border: "none",
          cursor: "pointer",
        }}
      >
        Close big picture
      </button>
    </div>
  );
}
