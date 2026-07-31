import { Navigate } from "react-router";

/** Everyone lands on Home (owner decision, 2026-07-31). */
export function HomeRedirect() {
  return <Navigate to="/home" replace />;
}
