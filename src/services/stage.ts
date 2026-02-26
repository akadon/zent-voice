import { stageRepository } from "../repositories/stage.repository.js";
import { voicestateRepository } from "../repositories/voicestate.repository.js";
import { ApiError } from "./voicestate.js";
import { generateId } from "../utils/snowflake.js";
import { dispatchGuild } from "../utils/dispatch.js";

export interface StageInstance {
  id: string;
  guildId: string;
  channelId: string;
  topic: string;
  privacyLevel: number;
  discoverableDisabled: boolean;
  guildScheduledEventId: string | null;
}

export const StagePrivacyLevel = {
  PUBLIC: 1,
  GUILD_ONLY: 2,
} as const;

export async function getStageInstance(channelId: string): Promise<StageInstance | null> {
  return stageRepository.findByChannel(channelId);
}

export async function getGuildStageInstances(guildId: string): Promise<StageInstance[]> {
  return stageRepository.findByGuild(guildId);
}

export async function createStageInstance(
  guildId: string,
  channelId: string,
  data: {
    topic: string;
    privacyLevel?: number;
    sendStartNotification?: boolean;
    guildScheduledEventId?: string;
  }
): Promise<StageInstance> {
  const existing = await stageRepository.findByChannel(channelId);
  if (existing) {
    throw new ApiError(400, "Stage instance already exists for this channel");
  }

  const id = generateId();
  const instance = await stageRepository.insert({
    id,
    guildId,
    channelId,
    topic: data.topic,
    privacyLevel: data.privacyLevel ?? StagePrivacyLevel.GUILD_ONLY,
    guildScheduledEventId: data.guildScheduledEventId ?? null,
    discoverableDisabled: false,
  });

  if (!instance) {
    throw new ApiError(500, "Failed to create stage instance");
  }

  return instance;
}

export async function updateStageInstance(
  channelId: string,
  data: {
    topic?: string;
    privacyLevel?: number;
  }
): Promise<StageInstance> {
  const updateData: Partial<{ topic: string; privacyLevel: number }> = {};
  if (data.topic !== undefined) updateData.topic = data.topic;
  if (data.privacyLevel !== undefined) updateData.privacyLevel = data.privacyLevel;

  const instance = await stageRepository.update(channelId, updateData);
  if (!instance) {
    throw new ApiError(404, "Stage instance not found");
  }

  return instance;
}

export async function deleteStageInstance(channelId: string): Promise<StageInstance> {
  const instance = await stageRepository.findByChannel(channelId);
  if (!instance) {
    throw new ApiError(404, "Stage instance not found");
  }

  await stageRepository.deleteByChannel(channelId);
  return instance;
}

export async function requestToSpeak(
  userId: string,
  guildId: string,
  channelId: string
): Promise<void> {
  const voiceState = await voicestateRepository.findByUserAndGuild(userId, guildId);
  if (!voiceState || voiceState.channelId !== channelId) {
    throw new ApiError(400, "User is not in this voice channel");
  }

  await dispatchGuild(guildId, "VOICE_STATE_UPDATE", {
    userId,
    guildId,
    channelId,
    requestToSpeakTimestamp: new Date().toISOString(),
  });
}

export async function inviteToSpeak(
  targetUserId: string,
  guildId: string,
  channelId: string
): Promise<void> {
  await voicestateRepository.update(targetUserId, guildId, { suppress: false });
}

export async function moveToAudience(
  targetUserId: string,
  guildId: string,
  channelId: string
): Promise<void> {
  await voicestateRepository.update(targetUserId, guildId, { suppress: true });
}

export async function getSpeakers(channelId: string): Promise<string[]> {
  return voicestateRepository.findByChannelAndSuppress(channelId, false);
}

export async function getAudience(channelId: string): Promise<string[]> {
  return voicestateRepository.findByChannelAndSuppress(channelId, true);
}
