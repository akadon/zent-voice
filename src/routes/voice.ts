import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as voicestateService from "../services/voicestate.js";
import { dispatchGuild } from "../utils/dispatch.js";
import { redis } from "../config/redis.js";

const VOICE_JOIN_RATE_LIMIT = `
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
    VOICE_JOIN_RATE_LIMIT,
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

async function checkVoiceJoinRate(userId: string): Promise<boolean> {
  return checkSlidingWindowRate("voicejoin", userId, 10, 10_000);
}

async function checkStateUpdateRate(userId: string): Promise<boolean> {
  return checkSlidingWindowRate("voicestate", userId, 20, 10_000);
}

async function checkSpatialUpdateRate(userId: string): Promise<boolean> {
  return checkSlidingWindowRate("spatial", userId, 10, 10_000);
}

export async function voiceRoutes(app: FastifyInstance) {
  // Join voice channel
  app.post("/voice/:guildId/:channelId/join", async (request, reply) => {
    const { guildId, channelId } = request.params as { guildId: string; channelId: string };
    const body = z
      .object({
        userId: z.string(),
        username: z.string(),
        channelType: z.number(),
        userLimit: z.number().nullable().optional(),
        selfMute: z.boolean().optional(),
        selfDeaf: z.boolean().optional(),
      })
      .parse(request.body);

    const allowed = await checkVoiceJoinRate(body.userId);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    const state = await voicestateService.joinVoiceChannel(
      body.userId,
      guildId,
      channelId,
      body.channelType,
      crypto.randomUUID(),
      body.username,
      body.userLimit ?? null,
      { selfMute: body.selfMute, selfDeaf: body.selfDeaf }
    );

    await dispatchGuild(guildId, "VOICE_STATE_UPDATE", state);

    return reply.send({
      voiceState: state,
      livekitToken: state.livekitToken,
      livekitUrl: state.livekitUrl,
    });
  });

  // Leave voice channel
  app.post("/voice/:guildId/leave", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z.object({ userId: z.string() }).parse(request.body);

    const previous = await voicestateService.leaveVoiceChannel(body.userId, guildId);
    if (previous) {
      await dispatchGuild(guildId, "VOICE_STATE_UPDATE", {
        userId: body.userId,
        guildId,
        channelId: null,
        sessionId: previous.sessionId,
      });
    }
    return reply.status(204).send();
  });

  // Get guild voice states
  app.get("/voice/:guildId/states", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const states = await voicestateService.getGuildVoiceStates(guildId);
    return reply.send(states);
  });

  // Update voice state
  app.patch("/voice/:guildId/:userId", async (request, reply) => {
    const { guildId, userId } = request.params as { guildId: string; userId: string };
    const body = z
      .object({
        selfMute: z.boolean().optional(),
        selfDeaf: z.boolean().optional(),
        selfStream: z.boolean().optional(),
        selfVideo: z.boolean().optional(),
      })
      .parse(request.body);

    if (!body || Object.keys(body).length === 0) {
      return reply.status(400).send({ statusCode: 400, message: "Empty body" });
    }

    const allowed = await checkStateUpdateRate(userId);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    const updated = await voicestateService.updateVoiceState(userId, guildId, body);
    await dispatchGuild(guildId, "VOICE_STATE_UPDATE", updated);
    return reply.send(updated);
  });

  // Update spatial audio position
  app.patch("/voice/:guildId/:channelId/spatial", async (request, reply) => {
    const { guildId, channelId } = request.params as { guildId: string; channelId: string };
    const body = z
      .object({
        userId: z.string(),
        x: z.number(),
        y: z.number(),
        z: z.number(),
      })
      .parse(request.body);

    const allowed = await checkSpatialUpdateRate(body.userId);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    const key = `spatial:${guildId}:${channelId}:${body.userId}`;
    await redis.set(key, JSON.stringify({ x: body.x, y: body.y, z: body.z }), "EX", 300);

    await dispatchGuild(guildId, "VOICE_SPATIAL_UPDATE", {
      guildId,
      channelId,
      userId: body.userId,
      position: { x: body.x, y: body.y, z: body.z },
    });

    return reply.status(204).send();
  });

  // Get spatial audio positions for a channel (batch pipeline)
  app.get("/voice/:guildId/:channelId/spatial/positions", async (request, reply) => {
    const { guildId, channelId } = request.params as { guildId: string; channelId: string };

    const states = await voicestateService.getGuildVoiceStates(guildId);
    const channelStates = states.filter((s: any) => s.channelId === channelId);

    if (channelStates.length === 0) {
      return reply.send([]);
    }

    const keys = channelStates.map((s: any) => `spatial:${guildId}:${channelId}:${s.userId}`);

    // Batch all spatial reads in one pipeline round-trip
    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.get(key);
    }
    const results = await pipeline.exec();

    const positions: Array<{ userId: string; x: number; y: number; z: number }> = [];
    if (results) {
      for (let i = 0; i < channelStates.length; i++) {
        const [err, val] = results[i] ?? [];
        if (!err && val) {
          const parsed = JSON.parse(val as string);
          positions.push({ userId: channelStates[i].userId, ...parsed });
        }
      }
    }

    return reply.send(positions);
  });

  // Server mute/deafen
  app.patch("/voice/:guildId/:userId/server", async (request, reply) => {
    const { guildId, userId } = request.params as { guildId: string; userId: string };
    const body = z
      .object({
        mute: z.boolean().optional(),
        deaf: z.boolean().optional(),
      })
      .parse(request.body);

    if (!body || Object.keys(body).length === 0) {
      return reply.status(400).send({ statusCode: 400, message: "Empty body" });
    }

    const allowed = await checkStateUpdateRate(userId);
    if (!allowed) {
      return reply.status(429).send({
        statusCode: 429,
        message: "You are being rate limited",
        retryAfter: 10,
      });
    }

    const updated = await voicestateService.serverMuteDeafen(userId, guildId, body);
    await dispatchGuild(guildId, "VOICE_STATE_UPDATE", updated);
    return reply.send(updated);
  });
}
