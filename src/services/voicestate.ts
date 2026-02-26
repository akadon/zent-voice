import crypto from "crypto";
import { voicestateRepository } from "../repositories/voicestate.repository.js";
import { redis } from "../config/redis.js";
import { config } from "../config/config.js";

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const VOICE_STATE_CACHE_TTL = 300; // 5 minutes

function cacheKey(guildId: string) {
  return `voicestates:${guildId}`;
}

async function invalidateGuildCache(guildId: string) {
  await redis.del(cacheKey(guildId));
}

function createLiveKitToken(roomName: string, participantId: string, participantName: string, canPublish = true): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: config.livekit.apiKey,
      sub: participantId,
      nbf: now,
      exp: now + 4 * 60 * 60,
      iat: now,
      jti: crypto.randomUUID(),
      video: {
        room: roomName,
        roomJoin: true,
        canPublish,
        canSubscribe: true,
        canPublishData: true,
      },
      name: participantName,
      metadata: JSON.stringify({ participantId }),
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", config.livekit.apiSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

export async function joinVoiceChannel(
  userId: string,
  guildId: string,
  channelId: string,
  channelType: number,
  sessionId: string,
  username: string,
  userLimit: number | null,
  options?: { selfMute?: boolean; selfDeaf?: boolean }
) {
  if (channelType !== 2 && channelType !== 13) {
    throw new ApiError(400, "Not a voice channel");
  }

  await voicestateRepository.transaction(async (tx) => {
    await voicestateRepository.deleteByUserAndGuild(userId, guildId, tx);

    if (userLimit && userLimit > 0) {
      const count = await voicestateRepository.countByChannel(channelId, tx);
      if (count >= userLimit) {
        throw new ApiError(400, "Voice channel is full");
      }
    }

    await voicestateRepository.insert(
      {
        userId,
        guildId,
        channelId,
        sessionId,
        selfMute: options?.selfMute ?? false,
        selfDeaf: options?.selfDeaf ?? false,
      },
      tx
    );
  });

  await invalidateGuildCache(guildId);

  const roomName = `voice-${guildId}-${channelId}`;
  const livekitToken = createLiveKitToken(roomName, userId, username, channelType !== 13);

  return {
    userId,
    guildId,
    channelId,
    sessionId,
    selfMute: options?.selfMute ?? false,
    selfDeaf: options?.selfDeaf ?? false,
    deaf: false,
    mute: false,
    selfStream: false,
    selfVideo: false,
    suppress: channelType === 13,
    livekitToken,
    livekitUrl: config.livekit.url,
  };
}

export async function leaveVoiceChannel(userId: string, guildId: string) {
  const existing = await voicestateRepository.findByUserAndGuild(userId, guildId);
  if (!existing) return null;

  await voicestateRepository.deleteByUserAndGuild(userId, guildId);
  await invalidateGuildCache(guildId);

  return existing;
}

export async function updateVoiceState(
  userId: string,
  guildId: string,
  data: {
    selfMute?: boolean;
    selfDeaf?: boolean;
    selfStream?: boolean;
    selfVideo?: boolean;
  }
) {
  const updated = await voicestateRepository.update(userId, guildId, data);
  if (!updated) throw new ApiError(404, "Not in a voice channel");

  await invalidateGuildCache(guildId);
  return updated;
}

export async function serverMuteDeafen(
  userId: string,
  guildId: string,
  data: { mute?: boolean; deaf?: boolean }
) {
  const updated = await voicestateRepository.update(userId, guildId, data);
  if (!updated) throw new ApiError(404, "User not in a voice channel");

  await invalidateGuildCache(guildId);
  return updated;
}

export async function getChannelVoiceStates(channelId: string) {
  return voicestateRepository.findByChannel(channelId);
}

export async function getGuildVoiceStates(guildId: string) {
  // Check Redis cache first
  const cached = await redis.get(cacheKey(guildId));
  if (cached) {
    return JSON.parse(cached);
  }

  const states = await voicestateRepository.findByGuild(guildId);

  // Warm cache
  if (states.length > 0) {
    await redis.set(cacheKey(guildId), JSON.stringify(states), "EX", VOICE_STATE_CACHE_TTL);
  }

  return states;
}
