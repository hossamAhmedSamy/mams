import { router } from "../trpc";
import { skillsRouter } from "./skills";
import { usersRouter } from "./users";

export const appRouter = router({
  users: usersRouter,
  skills: skillsRouter,
});

export type AppRouter = typeof appRouter;
