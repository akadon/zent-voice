import { soundboardRepository } from "../repositories/soundboard.repository.js";
import { ApiError } from "./voicestate.js";
import { generateId } from "../utils/snowflake.js";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

export interface SoundboardSound {
  id: string;
  guildId: string;
  name: string;
  volume: number;
  emojiId: string | null;
  emojiName: string | null;
  userId: string | null;
  available: boolean;
  soundUrl: string;
  createdAt: Date;
}

const MAX_SOUND_NAME_LENGTH = 32;

export async function getGuildSounds(guildId: string): Promise<SoundboardSound[]> {
  return soundboardRepository.findByGuild(guildId);
}

export async function getSound(soundId: string): Promise<SoundboardSound | null> {
  return soundboardRepository.findById(soundId);
}

export async function createSound(
  guildId: string,
  userId: string,
  premiumTier: number,
  data: {
    name: string;
    soundUrl: string;
    volume?: number;
    emojiId?: string;
    emojiName?: string;
  }
): Promise<SoundboardSound> {
  if (data.name.length > MAX_SOUND_NAME_LENGTH) {
    throw new ApiError(400, `Sound name must be ${MAX_SOUND_NAME_LENGTH} characters or less`);
  }

  const soundLimit = getSoundLimit(premiumTier);
  const id = generateId();

  const sound = await db.transaction(async (tx) => {
    // Lock existing rows for this guild to prevent concurrent inserts exceeding the limit
    await tx.execute(sql`
      SELECT id FROM soundboard_sounds WHERE guild_id = ${guildId} FOR UPDATE
    `);

    const existingSounds = await soundboardRepository.findByGuild(guildId);
    if (existingSounds.length >= soundLimit) {
      throw new ApiError(400, `This server has reached the maximum of ${soundLimit} sounds`);
    }

    await tx.execute(sql`
      INSERT INTO soundboard_sounds (id, guild_id, name, sound_url, volume, emoji_id, emoji_name, user_id, available, created_at)
      VALUES (${id}, ${guildId}, ${data.name}, ${data.soundUrl}, ${Math.min(100, Math.max(0, data.volume ?? 100))}, ${data.emojiId ?? null}, ${data.emojiName ?? null}, ${userId}, true, NOW())
    `);

    const [row] = await tx.execute(sql`
      SELECT * FROM soundboard_sounds WHERE id = ${id} LIMIT 1
    `);
    return row as unknown as SoundboardSound | null;
  });

  if (!sound) {
    throw new ApiError(500, "Failed to create sound");
  }

  return sound;
}

export async function updateSound(
  guildId: string,
  soundId: string,
  data: {
    name?: string;
    volume?: number;
    emojiId?: string | null;
    emojiName?: string | null;
  }
): Promise<SoundboardSound> {
  if (data.name && data.name.length > MAX_SOUND_NAME_LENGTH) {
    throw new ApiError(400, `Sound name must be ${MAX_SOUND_NAME_LENGTH} characters or less`);
  }

  const updateData: Partial<typeof data & { volume: number }> = { ...data };
  if (data.volume !== undefined) {
    updateData.volume = Math.min(100, Math.max(0, data.volume));
  }

  const sound = await soundboardRepository.update(guildId, soundId, updateData);
  if (!sound) {
    throw new ApiError(404, "Sound not found");
  }

  return sound;
}

export async function deleteSound(guildId: string, soundId: string): Promise<void> {
  const deleted = await soundboardRepository.delete(guildId, soundId);
  if (!deleted) {
    throw new ApiError(404, "Sound not found");
  }
}

export async function getUserFavorites(userId: string): Promise<SoundboardSound[]> {
  return soundboardRepository.findUserFavorites(userId);
}

export async function addFavorite(userId: string, soundId: string): Promise<void> {
  const sound = await soundboardRepository.findById(soundId);
  if (!sound) {
    throw new ApiError(404, "Sound not found");
  }
  await soundboardRepository.addFavorite(userId, soundId);
}

export async function removeFavorite(userId: string, soundId: string): Promise<void> {
  await soundboardRepository.removeFavorite(userId, soundId);
}

function getSoundLimit(premiumTier: number): number {
  switch (premiumTier) {
    case 0: return 8;
    case 1: return 24;
    case 2: return 36;
    case 3: return 48;
    default: return 8;
  }
}
