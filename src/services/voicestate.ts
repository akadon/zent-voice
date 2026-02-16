import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../config/env.js";
import crypto from "crypto";

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

function createLiveKitToken(roomName: string, participantId: string, participantName: string, canPublish = true): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: env.LIVEKIT_API_KEY,
      sub: participantId,
      nbf: now,
      exp: now + 86400,
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
    .createHmac("sha256", env.LIVEKIT_API_SECRET)
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

  await db.transaction(async (tx) => {
    if (userLimit && userLimit > 0) {
      const currentUsers = await tx
        .select()
        .from(schema.voiceStates)
        .where(eq(schema.voiceStates.channelId, channelId));
      if (currentUsers.length >= userLimit) {
        throw new ApiError(400, "Voice channel is full");
      }
    }

    await tx
      .delete(schema.voiceStates)
      .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)));

    await tx.insert(schema.voiceStates).values({
      userId,
      guildId,
      channelId,
      sessionId,
      selfMute: options?.selfMute ?? false,
      selfDeaf: options?.selfDeaf ?? false,
    });
  });

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
    livekitUrl: env.LIVEKIT_URL,
  };
}

export async function leaveVoiceChannel(userId: string, guildId: string) {
  const [existing] = await db
    .select()
    .from(schema.voiceStates)
    .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)))
    .limit(1);

  if (!existing) return null;

  await db
    .delete(schema.voiceStates)
    .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)));

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
  const [updated] = await db
    .update(schema.voiceStates)
    .set(data)
    .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)))
    .returning();

  if (!updated) throw new ApiError(404, "Not in a voice channel");
  return updated;
}

export async function serverMuteDeafen(
  userId: string,
  guildId: string,
  data: { mute?: boolean; deaf?: boolean }
) {
  const [updated] = await db
    .update(schema.voiceStates)
    .set(data)
    .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)))
    .returning();

  if (!updated) throw new ApiError(404, "User not in a voice channel");
  return updated;
}

export async function getChannelVoiceStates(channelId: string) {
  return db
    .select()
    .from(schema.voiceStates)
    .where(eq(schema.voiceStates.channelId, channelId));
}

export async function getGuildVoiceStates(guildId: string) {
  return db
    .select()
    .from(schema.voiceStates)
    .where(eq(schema.voiceStates.guildId, guildId));
}
