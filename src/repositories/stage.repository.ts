import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const stageRepository = {
  async findByChannel(channelId: string) {
    const [row] = await db
      .select()
      .from(schema.stageInstances)
      .where(eq(schema.stageInstances.channelId, channelId))
      .limit(1);
    return row ?? null;
  },

  async findByGuild(guildId: string) {
    return db
      .select()
      .from(schema.stageInstances)
      .where(eq(schema.stageInstances.guildId, guildId));
  },

  async findById(id: string) {
    const [row] = await db
      .select()
      .from(schema.stageInstances)
      .where(eq(schema.stageInstances.id, id))
      .limit(1);
    return row ?? null;
  },

  async insert(data: {
    id: string;
    guildId: string;
    channelId: string;
    topic: string;
    privacyLevel: number;
    guildScheduledEventId: string | null;
    discoverableDisabled: boolean;
  }) {
    await db.insert(schema.stageInstances).values(data);
    const [row] = await db
      .select()
      .from(schema.stageInstances)
      .where(eq(schema.stageInstances.id, data.id))
      .limit(1);
    return row ?? null;
  },

  async update(channelId: string, data: Partial<{ topic: string; privacyLevel: number }>) {
    await db
      .update(schema.stageInstances)
      .set(data)
      .where(eq(schema.stageInstances.channelId, channelId));
    const [row] = await db
      .select()
      .from(schema.stageInstances)
      .where(eq(schema.stageInstances.channelId, channelId))
      .limit(1);
    return row ?? null;
  },

  async deleteByChannel(channelId: string) {
    return db
      .delete(schema.stageInstances)
      .where(eq(schema.stageInstances.channelId, channelId));
  },
};
