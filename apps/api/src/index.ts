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

// Graceful shutdown: release the listening socket (port) before exit so
// tsx-watch reloads and Ctrl+C never leave a process squatting on the port.
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} received, closing server…`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}
