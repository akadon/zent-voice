import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as stageService from "../services/stage.js";
import { redisPub } from "../config/redis.js";

async function dispatchGuild(guildId: string, event: string, data: unknown) {
  await redisPub.publish(
    `gateway:guild:${guildId}`,
    JSON.stringify({ event, data })
  );
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

    const instance = await stageService.updateStageInstance(channelId, body);
    await dispatchGuild(body.guildId, "STAGE_INSTANCE_UPDATE", instance);
    return reply.send(instance);
  });

  // Delete stage instance
  app.delete("/stage-instances/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z.object({ guildId: z.string() }).parse(request.body);

    const instance = await stageService.deleteStageInstance(channelId);
    await dispatchGuild(body.guildId, "STAGE_INSTANCE_DELETE", instance);
    return reply.status(204).send();
  });

  // Request to speak
  app.post("/stage-instances/:channelId/request-to-speak", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z.object({ userId: z.string(), guildId: z.string() }).parse(request.body);

    await stageService.requestToSpeak(body.userId, body.guildId, channelId);
    return reply.status(204).send();
  });

  // Invite to speak
  app.post("/stage-instances/:channelId/speakers/:userId", async (request, reply) => {
    const { channelId, userId } = request.params as { channelId: string; userId: string };
    const body = z.object({ guildId: z.string() }).parse(request.body);

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
