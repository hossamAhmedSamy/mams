import { Navigate } from "react-router";

/** Landing = My Work: your calendar + your assigned tasks (owner decision). */
export function HomeRedirect() {
  return <Navigate to="/my-work" replace />;
}
