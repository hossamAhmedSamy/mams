import { router } from "../trpc";
import { activityRouter } from "./activity";
import { clientsRouter } from "./clients";
import { commentsRouter } from "./comments";
import { dashboardRouter } from "./dashboard";
import { financeRouter } from "./finance";
import { hrRouter } from "./hr";
import { projectsRouter } from "./projects";
import { skillsRouter } from "./skills";
import { tasksRouter } from "./tasks";
import { usersRouter } from "./users";
import { workflowsRouter } from "./workflows";

export const appRouter = router({
  users: usersRouter,
  skills: skillsRouter,
  clients: clientsRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  comments: commentsRouter,
  activity: activityRouter,
  workflows: workflowsRouter,
  finance: financeRouter,
  hr: hrRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
