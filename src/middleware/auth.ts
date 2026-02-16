import type { FastifyRequest, FastifyReply } from "fastify";
import { env } from "../config/env.js";

export async function internalAuth(request: FastifyRequest, reply: FastifyReply) {
  const key = request.headers["x-internal-key"];
  if (typeof key !== "string" || key !== env.INTERNAL_API_KEY) {
    reply.status(401).send({ error: "Unauthorized" });
    return reply;
  }
}
