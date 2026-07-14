import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import type { AppRouter } from "@api/trpc/routers/index";
import { TRPCProvider } from "@/lib/trpc";
import { AppLayout } from "@/routes/app-layout";
import { ChangePasswordPage } from "@/routes/change-password";
import { HomeRedirect } from "@/routes/home-redirect";
import { LoginPage } from "@/routes/login";
import { BoardPage } from "@/routes/board";
import { MyWorkPage } from "@/routes/my-work";
import { ProjectDetailPage } from "@/routes/project-detail";
import { UsersSettingsPage } from "@/routes/settings-users";
import { TaskDetailPage } from "@/routes/task-detail";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc" })],
});

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/change-password", element: <ChangePasswordPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <HomeRedirect /> },
      { path: "/my-work", element: <MyWorkPage /> },
      { path: "/board", element: <BoardPage /> },
      { path: "/projects/:id", element: <ProjectDetailPage /> },
      { path: "/tasks/:id", element: <TaskDetailPage /> },
      { path: "/settings/users", element: <UsersSettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
