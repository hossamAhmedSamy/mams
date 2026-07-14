import { Navigate } from "react-router";
import { useMe } from "./app-layout";

export function HomeRedirect() {
  const me = useMe();
  if (me.isPending || me.isError) return null; // layout handles loading/auth
  return <Navigate to={me.data.role === "admin" ? "/board" : "/my-work"} replace />;
}
