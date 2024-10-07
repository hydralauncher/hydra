import { useSearchParams } from "react-router-dom";

export function Achievement() {
  const [searchParams] = useSearchParams();

  return (
    <div>
      <h1>Achievement</h1>
    </div>
  );
}
