import { soundboardRepository } from "../repositories/soundboard.repository.js";
import { ApiError } from "./voicestate.js";
import { generateId } from "../utils/snowflake.js";

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

  const existingSounds = await soundboardRepository.findByGuild(guildId);
  const soundLimit = getSoundLimit(premiumTier);

  if (existingSounds.length >= soundLimit) {
    throw new ApiError(400, `This server has reached the maximum of ${soundLimit} sounds`);
  }

  const id = generateId();
  const sound = await soundboardRepository.insert({
    id,
    guildId,
    name: data.name,
    soundUrl: data.soundUrl,
    volume: Math.min(100, Math.max(0, data.volume ?? 100)),
    emojiId: data.emojiId ?? null,
    emojiName: data.emojiName ?? null,
    userId,
    available: true,
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
