import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as stageService from "../services/stage.js";
import { dispatchGuild } from "../utils/dispatch.js";
import { redis } from "../config/redis.js";

const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
local count = redis.call('ZCARD', key)

if count < max_requests then
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, ttl)
  return 1
else
  return 0
end
`;

async function checkSlidingWindowRate(
  keyPrefix: string,
  id: string,
  maxRequests: number,
  windowMs: number
): Promise<boolean> {
  const key = `rl:${keyPrefix}:${id}`;
  const now = Date.now();
  const windowStart = now - windowMs;
  const ttl = Math.ceil(windowMs / 1000) + 1;
  const member = `${now}:${Math.random()}`;

  const allowed = await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,
    key,
    now.toString(),
    windowStart.toString(),
    maxRequests.toString(),
    ttl.toString(),
    member
  );

  return allowed === 1;
}

export async function stageRoutes(app: FastifyInstance) {
  // Create stage instance
  app.post("/stage-instances", async (request, reply) => {
    const body = z
      .object({
        guildId: z.string(),
        channelId: z.string(),
        topic: z.string().min(1).max(120),
        privacyLevel: z.number().int().min(1).max(2).optional(),
        sendStartNotification: z.boolean().optional(),
        guildScheduledEventId: z.string().optional(),
      })
      .parse(request.body);

    const allowed = await checkSlidingWindowRate("stagecreate", body.guildId, 5, 10_000);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    const instance = await stageService.createStageInstance(
      body.guildId,
      body.channelId,
      {
        topic: body.topic,
        privacyLevel: body.privacyLevel,
        sendStartNotification: body.sendStartNotification,
        guildScheduledEventId: body.guildScheduledEventId,
      }
    );

    await dispatchGuild(body.guildId, "STAGE_INSTANCE_CREATE", instance);
    return reply.status(201).send(instance);
  });

  // Get stage instance
  app.get("/stage-instances/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const instance = await stageService.getStageInstance(channelId);
    if (!instance) {
      return reply.status(404).send({ message: "Stage instance not found" });
    }
    return reply.send(instance);
  });

  // Update stage instance
  app.patch("/stage-instances/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        guildId: z.string(),
        topic: z.string().min(1).max(120).optional(),
        privacyLevel: z.number().int().min(1).max(2).optional(),
      })
      .parse(request.body);

    const allowed = await checkSlidingWindowRate("stageupdate", body.guildId, 10, 10_000);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    const { guildId, ...updateData } = body;
    if (Object.keys(updateData).length === 0) {
      return reply.status(400).send({ statusCode: 400, message: "Empty body" });
    }

    // Verify the stage instance belongs to the guild
    const existing = await stageService.getStageInstance(channelId);
    if (!existing) {
      return reply.status(404).send({ statusCode: 404, message: "Stage instance not found" });
    }
    if (existing.guildId !== guildId) {
      return reply.status(403).send({ statusCode: 403, message: "Stage instance does not belong to this guild" });
    }

    const instance = await stageService.updateStageInstance(channelId, updateData);
    await dispatchGuild(guildId, "STAGE_INSTANCE_UPDATE", instance);
    return reply.send(instance);
  });

  // Delete stage instance
  app.delete("/stage-instances/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z.object({ guildId: z.string() }).parse(request.body);

    const allowed = await checkSlidingWindowRate("stagedelete", body.guildId, 5, 10_000);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    // Verify the stage instance belongs to the guild
    const existing = await stageService.getStageInstance(channelId);
    if (!existing) {
      return reply.status(404).send({ statusCode: 404, message: "Stage instance not found" });
    }
    if (existing.guildId !== body.guildId) {
      return reply.status(403).send({ statusCode: 403, message: "Stage instance does not belong to this guild" });
    }

    const instance = await stageService.deleteStageInstance(channelId);
    await dispatchGuild(body.guildId, "STAGE_INSTANCE_DELETE", instance);
    return reply.status(204).send();
  });

  // Request to speak
  app.post("/stage-instances/:channelId/request-to-speak", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z.object({ userId: z.string(), guildId: z.string() }).parse(request.body);

    const allowed = await checkSlidingWindowRate("stagespeak", body.userId, 5, 10_000);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    const existing = await stageService.getStageInstance(channelId);
    if (!existing) {
      return reply.status(404).send({ statusCode: 404, message: "Stage instance not found" });
    }
    if (existing.guildId !== body.guildId) {
      return reply.status(403).send({ statusCode: 403, message: "Stage instance does not belong to this guild" });
    }

    await stageService.requestToSpeak(body.userId, body.guildId, channelId);
    return reply.status(204).send();
  });

  // Invite to speak
  app.post("/stage-instances/:channelId/speakers/:userId", async (request, reply) => {
    const { channelId, userId } = request.params as { channelId: string; userId: string };
    const body = z.object({ guildId: z.string() }).parse(request.body);

    const allowed = await checkSlidingWindowRate("stageinvite", body.guildId, 10, 10_000);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    const existing = await stageService.getStageInstance(channelId);
    if (!existing) {
      return reply.status(404).send({ statusCode: 404, message: "Stage instance not found" });
    }
    if (existing.guildId !== body.guildId) {
      return reply.status(403).send({ statusCode: 403, message: "Stage instance does not belong to this guild" });
    }

    await stageService.inviteToSpeak(userId, body.guildId, channelId);
    await dispatchGuild(body.guildId, "VOICE_STATE_UPDATE", {
      userId,
      guildId: body.guildId,
      channelId,
      suppress: false,
    });
    return reply.status(204).send();
  });

  // Move to audience
  app.delete("/stage-instances/:channelId/speakers/:userId", async (request, reply) => {
    const { channelId, userId } = request.params as { channelId: string; userId: string };
    const body = z.object({ guildId: z.string() }).parse(request.body);

    const allowed = await checkSlidingWindowRate("stagemove", body.guildId, 10, 10_000);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    const existing = await stageService.getStageInstance(channelId);
    if (!existing) {
      return reply.status(404).send({ statusCode: 404, message: "Stage instance not found" });
    }
    if (existing.guildId !== body.guildId) {
      return reply.status(403).send({ statusCode: 403, message: "Stage instance does not belong to this guild" });
    }

    await stageService.moveToAudience(userId, body.guildId, channelId);
    await dispatchGuild(body.guildId, "VOICE_STATE_UPDATE", {
      userId,
      guildId: body.guildId,
      channelId,
      suppress: true,
    });
    return reply.status(204).send();
  });

  // Get speakers
  app.get("/stage-instances/:channelId/speakers", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const speakers = await stageService.getSpeakers(channelId);
    return reply.send(speakers);
  });

  // Get audience
  app.get("/stage-instances/:channelId/audience", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const audience = await stageService.getAudience(channelId);
    return reply.send(audience);
  });
}
