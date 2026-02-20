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

async function checkVoiceJoinRate(userId: string): Promise<boolean> {
  const key = `rl:voicejoin:${userId}`;
  const now = Date.now();
  const windowStart = now - 10_000; // 10 second window
  const member = `${now}:${Math.random()}`;

  const allowed = await redis.eval(
    VOICE_JOIN_RATE_LIMIT,
    1,
    key,
    now.toString(),
    windowStart.toString(),
    "10", // max 10 requests
    "11", // TTL slightly longer than window
    member
  );

  return allowed === 1;
}

export async function voiceRoutes(app: FastifyInstance) {
  // Join voice channel
  // Caller (zent-server or direct) must pass channel info since we don't own the channels table
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

    const key = `spatial:${guildId}:${channelId}:${body.userId}`;
    const { redis } = await import("../config/redis.js");
    await redis.set(key, JSON.stringify({ x: body.x, y: body.y, z: body.z }), "EX", 300);

    await dispatchGuild(guildId, "VOICE_SPATIAL_UPDATE", {
      guildId,
      channelId,
      userId: body.userId,
      position: { x: body.x, y: body.y, z: body.z },
    });

    return reply.status(204).send();
  });

  // Get spatial audio positions for a channel
  app.get("/voice/:guildId/:channelId/spatial/positions", async (request, reply) => {
    const { guildId, channelId } = request.params as { guildId: string; channelId: string };

    const states = await voicestateService.getGuildVoiceStates(guildId);
    const channelStates = states.filter((s: any) => s.channelId === channelId);

    const { redis } = await import("../config/redis.js");
    const positions: Array<{ userId: string; x: number; y: number; z: number }> = [];
    for (const state of channelStates) {
      const key = `spatial:${guildId}:${channelId}:${state.userId}`;
      const pos = await redis.get(key);
      if (pos) {
        const parsed = JSON.parse(pos);
        positions.push({ userId: state.userId, ...parsed });
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

    const updated = await voicestateService.serverMuteDeafen(userId, guildId, body);
    await dispatchGuild(guildId, "VOICE_STATE_UPDATE", updated);
    return reply.send(updated);
  });
}
