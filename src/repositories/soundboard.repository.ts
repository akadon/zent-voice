import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const soundboardRepository = {
  async findByGuild(guildId: string) {
    return db
      .select()
      .from(schema.soundboardSounds)
      .where(eq(schema.soundboardSounds.guildId, guildId));
  },

  async findById(soundId: string) {
    const [row] = await db
      .select()
      .from(schema.soundboardSounds)
      .where(eq(schema.soundboardSounds.id, soundId))
      .limit(1);
    return row ?? null;
  },

  async insert(data: {
    id: string;
    guildId: string;
    name: string;
    soundUrl: string;
    volume: number;
    emojiId: string | null;
    emojiName: string | null;
    userId: string;
    available: boolean;
  }) {
    await db.insert(schema.soundboardSounds).values(data);
    const [row] = await db
      .select()
      .from(schema.soundboardSounds)
      .where(eq(schema.soundboardSounds.id, data.id))
      .limit(1);
    return row ?? null;
  },

  async update(guildId: string, soundId: string, data: Partial<{
    name: string;
    volume: number;
    emojiId: string | null;
    emojiName: string | null;
  }>) {
    await db
      .update(schema.soundboardSounds)
      .set(data)
      .where(
        and(
          eq(schema.soundboardSounds.id, soundId),
          eq(schema.soundboardSounds.guildId, guildId)
        )
      );
    const [row] = await db
      .select()
      .from(schema.soundboardSounds)
      .where(eq(schema.soundboardSounds.id, soundId))
      .limit(1);
    return row ?? null;
  },

  async delete(guildId: string, soundId: string) {
    const [existing] = await db
      .select()
      .from(schema.soundboardSounds)
      .where(
        and(
          eq(schema.soundboardSounds.id, soundId),
          eq(schema.soundboardSounds.guildId, guildId)
        )
      )
      .limit(1);
    if (!existing) return false;
    await db
      .delete(schema.soundboardSounds)
      .where(
        and(
          eq(schema.soundboardSounds.id, soundId),
          eq(schema.soundboardSounds.guildId, guildId)
        )
      );
    return true;
  },

  async findUserFavorites(userId: string) {
    const result = await db
      .select({ sound: schema.soundboardSounds })
      .from(schema.userSoundboardFavorites)
      .innerJoin(
        schema.soundboardSounds,
        eq(schema.userSoundboardFavorites.soundId, schema.soundboardSounds.id)
      )
      .where(eq(schema.userSoundboardFavorites.userId, userId));
    return result.map((r) => r.sound);
  },

  async addFavorite(userId: string, soundId: string) {
    try {
      await db.insert(schema.userSoundboardFavorites).values({ userId, soundId });
    } catch (error: any) {
      if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) return;
      throw error;
    }
  },

  async removeFavorite(userId: string, soundId: string) {
    await db
      .delete(schema.userSoundboardFavorites)
      .where(
        and(
          eq(schema.userSoundboardFavorites.userId, userId),
          eq(schema.userSoundboardFavorites.soundId, soundId)
        )
      );
  },
};
