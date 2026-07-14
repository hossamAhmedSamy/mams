import { createDb } from "@mams/db";
import { env } from "./env";

export const db = createDb(env.DATABASE_URL);
export type { Db } from "@mams/db";
