import { buildApp } from "./app";
import { env } from "./env";
import { startTicker } from "./jobs/tick";

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  startTicker(app.log);
  app.log.info(`MAMS api ready on :${env.PORT} (${env.NODE_ENV})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
