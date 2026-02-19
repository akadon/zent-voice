import Fastify from "fastify";
import cors from "@fastify/cors";
import crypto from "crypto";
import { createServer } from "http";
import { env } from "./config/env.js";
import { voiceRoutes } from "./routes/voice.js";
import { stageRoutes } from "./routes/stage.js";
import { soundboardRoutes } from "./routes/soundboard.js";
import { createVoiceGateway } from "./gateway/index.js";
import { ApiError } from "./services/voicestate.js";
import { ZodError } from "zod";
import { sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { redisPub, redisSub } from "./config/redis.js";
import { internalAuth } from "./middleware/auth.js";

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

await app.register(cors, {
  origin: env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true,
});

app.addHook("onRequest", async (request, reply) => {
  // Request ID tracing
  const requestId = (request.headers["x-request-id"] as string) ?? crypto.randomUUID();
  reply.header("x-request-id", requestId);
  (request as any).requestId = requestId;

  if (request.url === "/health") return;
  await internalAuth(request, reply);
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      message: error.message,
    });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      statusCode: 400,
      message: "Validation error",
      errors: error.errors,
    });
  }

  app.log.error(error);
  return reply.status(500).send({
    statusCode: 500,
    message: "Internal server error",
  });
});

await app.register(voiceRoutes, { prefix: "/api" });
await app.register(stageRoutes, { prefix: "/api" });
await app.register(soundboardRoutes, { prefix: "/api" });

app.get("/health", async (_request, reply) => {
  try {
    await db.execute(sql`SELECT 1`);
    await redisPub.ping();
    return { status: "ok", service: "stream" };
  } catch {
    return reply.status(503).send({ statusCode: 503, message: "unhealthy" });
  }
});

const start = async () => {
  try {
    const server = app.server;
    const io = createVoiceGateway(server);
    app.decorate("io", io);

    await app.listen({ port: env.VOICE_PORT, host: env.VOICE_HOST });
    app.log.info(`Stream service listening on ${env.VOICE_HOST}:${env.VOICE_PORT}`);

    const shutdown = async (signal: string) => {
      app.log.info(`Received ${signal}, shutting down`);
      try {
        io.close();
        await app.close();
        redisPub.disconnect();
        redisSub.disconnect();
      } catch (err) {
        app.log.error(err);
      }
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
