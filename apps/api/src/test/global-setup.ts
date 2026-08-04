/** Creates a fresh mams_test database, migrates it, and seeds domain data. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@mams/db";
import { seedDomain } from "@mams/db/seed-data";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { seedTestWorkflow } from "./fixtures";

export default async function setup() {
  const admin = new pg.Client({
    connectionString: "postgres://mams:mams@localhost:5433/mams",
  });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS mams_test WITH (FORCE)");
  await admin.query("CREATE DATABASE mams_test");
  await admin.end();

  const db = createDb("postgres://mams:mams@localhost:5433/mams_test");
  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../packages/db/migrations",
  );
  await migrate(db, { migrationsFolder });
  await seedDomain(db);
  await seedTestWorkflow(db); // the deeper chain the engine tests need

  await (db.$client as pg.Pool).end();
}
