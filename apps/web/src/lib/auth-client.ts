import { createAuthClient } from "better-auth/react";

/** Same-origin in trial mode and dev (Vite proxies /api). */
export const authClient = createAuthClient({
  basePath: "/api/auth",
});
