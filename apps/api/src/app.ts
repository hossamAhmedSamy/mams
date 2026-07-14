import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import { auth } from "./auth";
import { env } from "./env";
import { runDueJobs } from "./jobs/tick";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/routers/index";

const API_PREFIXES = ["/api/", "/trpc/", "/jobs/", "/healthz", "/mcp"];

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "test" ? "warn" : "info",
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: true, // Render terminates TLS in front of us
  });

  // --- security headers (PLAN.md §7.3) ------------------------------------
  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    if (env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
    if (reply.getHeader("content-type")?.toString().includes("text/html")) {
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      );
    }
  });

  // --- better-auth (session routes) ----------------------------------------
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, env.BETTER_AUTH_URL);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers.append(key, Array.isArray(value) ? value.join(", ") : value.toString());
      }
      const webRequest = new Request(url.toString(), {
        method: request.method,
        headers,
        body:
          request.method === "POST" && request.body !== undefined && request.body !== null
            ? JSON.stringify(request.body)
            : undefined,
      });
      const response = await auth.handler(webRequest);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      reply.send(response.body ? await response.text() : null);
    },
  });

  // --- tRPC -----------------------------------------------------------------
  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ error, path: procPath }: { error: Error; path?: string }) {
        app.log.error({ err: error, procPath }, "tRPC error");
      },
    },
  });

  // --- health ----------------------------------------------------------------
  app.get("/healthz", async () => ({ ok: true, ts: new Date().toISOString() }));

  // --- job tick (PLAN.md §6.1): external cron + in-process ticker target ------
  app.post("/jobs/tick", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (!token || !timingSafeEqualStr(token, env.JOB_TRIGGER_TOKEN)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const result = await runDueJobs();
    return { ok: true, ...result };
  });

  // --- static SPA (trial mode: single origin) ---------------------------------
  const webDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../web/dist",
  );
  if (existsSync(webDist)) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (API_PREFIXES.some((p) => request.url.startsWith(p))) {
        return reply.status(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html"); // SPA route fallback
    });
  }

  return app;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
