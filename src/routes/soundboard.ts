import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as soundboardService from "../services/soundboard.js";
import { dispatchGuild } from "../utils/dispatch.js";

export async function soundboardRoutes(app: FastifyInstance) {
  // Get guild sounds
  app.get("/guilds/:guildId/soundboard-sounds", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const sounds = await soundboardService.getGuildSounds(guildId);
    return reply.send({ items: sounds });
  });

  // Get single sound
  app.get("/guilds/:guildId/soundboard-sounds/:soundId", async (request, reply) => {
    const { guildId, soundId } = request.params as { guildId: string; soundId: string };
    const sound = await soundboardService.getSound(soundId);
    if (!sound || sound.guildId !== guildId) {
      return reply.status(404).send({ message: "Sound not found" });
    }
    return reply.send(sound);
  });

  // Create sound
  app.post("/guilds/:guildId/soundboard-sounds", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        userId: z.string(),
        premiumTier: z.number().default(0),
        name: z.string().min(1).max(32),
        soundUrl: z.string().url(),
        volume: z.number().int().min(0).max(100).optional(),
        emojiId: z.string().optional(),
        emojiName: z.string().optional(),
      })
      .parse(request.body);

    const sound = await soundboardService.createSound(guildId, body.userId, body.premiumTier, {
      name: body.name,
      soundUrl: body.soundUrl,
      volume: body.volume,
      emojiId: body.emojiId,
      emojiName: body.emojiName,
    });

    await dispatchGuild(guildId, "GUILD_SOUNDBOARD_SOUND_CREATE", sound);
    return reply.status(201).send(sound);
  });

  // Update sound
  app.patch("/guilds/:guildId/soundboard-sounds/:soundId", async (request, reply) => {
    const { guildId, soundId } = request.params as { guildId: string; soundId: string };
    const body = z
      .object({
        name: z.string().min(1).max(32).optional(),
        volume: z.number().int().min(0).max(100).optional(),
        emojiId: z.string().nullable().optional(),
        emojiName: z.string().nullable().optional(),
      })
      .parse(request.body);

    if (!body || Object.keys(body).length === 0) {
      return reply.status(400).send({ statusCode: 400, message: "Empty body" });
    }

    const sound = await soundboardService.updateSound(guildId, soundId, body);
    await dispatchGuild(guildId, "GUILD_SOUNDBOARD_SOUND_UPDATE", sound);
    return reply.send(sound);
  });

  // Delete sound
  app.delete("/guilds/:guildId/soundboard-sounds/:soundId", async (request, reply) => {
    const { guildId, soundId } = request.params as { guildId: string; soundId: string };

    await soundboardService.deleteSound(guildId, soundId);
    await dispatchGuild(guildId, "GUILD_SOUNDBOARD_SOUND_DELETE", { soundId, guildId });
    return reply.status(204).send();
  });

  // Play sound in voice channel
  app.post("/channels/:channelId/send-soundboard-sound", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        soundId: z.string(),
        userId: z.string(),
        guildId: z.string(),
      })
      .parse(request.body);

    const sound = await soundboardService.getSound(body.soundId);
    if (!sound) {
      return reply.status(404).send({ message: "Sound not found" });
    }

    await dispatchGuild(body.guildId, "VOICE_CHANNEL_EFFECT_SEND", {
      channelId,
      guildId: body.guildId,
      userId: body.userId,
      soundId: body.soundId,
    });

    return reply.status(204).send();
  });

  // User favorites
  app.get("/users/:userId/soundboard-sounds", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const favorites = await soundboardService.getUserFavorites(userId);
    return reply.send({ items: favorites });
  });

  app.put("/users/:userId/soundboard-sounds/:soundId", async (request, reply) => {
    const { userId, soundId } = request.params as { userId: string; soundId: string };
    await soundboardService.addFavorite(userId, soundId);
    return reply.status(204).send();
  });

  app.delete("/users/:userId/soundboard-sounds/:soundId", async (request, reply) => {
    const { userId, soundId } = request.params as { userId: string; soundId: string };
    await soundboardService.removeFavorite(userId, soundId);
    return reply.status(204).send();
  });
}
