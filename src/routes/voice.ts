import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as voicestateService from "../services/voicestate.js";
import { dispatchGuild } from "../utils/dispatch.js";

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
