import crypto from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { env } from "../config/env.js";

export async function internalAuth(request: FastifyRequest, reply: FastifyReply) {
  const key = request.headers["x-internal-key"];
  if (typeof key !== "string") {
    reply.status(401).send({ error: "Unauthorized" });
    return reply;
  }
  const keyBuf = Buffer.from(key);
  const expectedBuf = Buffer.from(env.INTERNAL_API_KEY);
  if (keyBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(keyBuf, expectedBuf)) {
    reply.status(401).send({ error: "Unauthorized" });
    return reply;
  }
}
