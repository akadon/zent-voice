import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const voicestateRepository = {
  async findByUserAndGuild(userId: string, guildId: string) {
    const [row] = await db
      .select()
      .from(schema.voiceStates)
      .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)))
      .limit(1);
    return row ?? null;
  },

  async findByChannel(channelId: string) {
    return db
      .select()
      .from(schema.voiceStates)
      .where(eq(schema.voiceStates.channelId, channelId));
  },

  async findByGuild(guildId: string) {
    return db
      .select()
      .from(schema.voiceStates)
      .where(eq(schema.voiceStates.guildId, guildId));
  },

  async countByChannel(channelId: string, tx?: any) {
    const executor = tx ?? db;
    const [result] = await executor.execute(sql`
      SELECT COUNT(*) as cnt FROM voice_states WHERE channel_id = ${channelId}
    `);
    return (result as any).cnt as number;
  },

  async deleteByUserAndGuild(userId: string, guildId: string, tx?: any) {
    const executor = tx ?? db;
    return executor
      .delete(schema.voiceStates)
      .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)));
  },

  async insert(
    data: {
      userId: string;
      guildId: string;
      channelId: string;
      sessionId: string;
      selfMute: boolean;
      selfDeaf: boolean;
    },
    tx?: any
  ) {
    const executor = tx ?? db;
    return executor.insert(schema.voiceStates).values(data);
  },

  async update(
    userId: string,
    guildId: string,
    data: Partial<{
      selfMute: boolean;
      selfDeaf: boolean;
      selfStream: boolean;
      selfVideo: boolean;
      mute: boolean;
      deaf: boolean;
      suppress: boolean;
    }>
  ) {
    const condition = and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId));
    await db.update(schema.voiceStates).set(data).where(condition);
    const [updated] = await db.select().from(schema.voiceStates).where(condition);
    return updated ?? null;
  },

  async findByChannelAndSuppress(channelId: string, suppress: boolean) {
    const rows = await db
      .select({ userId: schema.voiceStates.userId })
      .from(schema.voiceStates)
      .where(
        and(
          eq(schema.voiceStates.channelId, channelId),
          eq(schema.voiceStates.suppress, suppress)
        )
      );
    return rows.map((r) => r.userId);
  },

  transaction: db.transaction.bind(db),
};
