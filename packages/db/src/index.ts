import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export * as schema from "./schema/index";
export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  return drizzle(pool, { schema, casing: "snake_case" });
}
