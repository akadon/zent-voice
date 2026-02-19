import {
  mysqlTable,
  varchar,
  text,
  int,
  boolean,
  datetime,
  primaryKey,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ── Voice States ──
export const voiceStates = mysqlTable(
  "voice_states",
  {
    userId: varchar("user_id", { length: 64 }).notNull(),
    guildId: varchar("guild_id", { length: 64 }).notNull(),
    channelId: varchar("channel_id", { length: 64 }),
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    deaf: boolean("deaf").notNull().default(false),
    mute: boolean("mute").notNull().default(false),
    selfDeaf: boolean("self_deaf").notNull().default(false),
    selfMute: boolean("self_mute").notNull().default(false),
    selfStream: boolean("self_stream").notNull().default(false),
    selfVideo: boolean("self_video").notNull().default(false),
    suppress: boolean("suppress").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.guildId] }),
    index("voice_states_channel_id_idx").on(table.channelId),
  ]
);

// ── Stage Instances ──
export const stageInstances = mysqlTable(
  "stage_instances",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 }).notNull(),
    channelId: varchar("channel_id", { length: 64 }).notNull(),
    topic: text("topic").notNull(),
    privacyLevel: int("privacy_level").notNull().default(2),
    guildScheduledEventId: varchar("guild_scheduled_event_id", { length: 64 }),
    discoverableDisabled: boolean("discoverable_disabled").notNull().default(false),
  },
  (table) => [
    index("stage_instances_guild_idx").on(table.guildId),
  ]
);

// ── Soundboard Sounds ──
export const soundboardSounds = mysqlTable(
  "soundboard_sounds",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    volume: int("volume").notNull().default(100),
    emojiId: varchar("emoji_id", { length: 64 }),
    emojiName: varchar("emoji_name", { length: 255 }),
    userId: varchar("user_id", { length: 64 }),
    available: boolean("available").notNull().default(true),
    soundUrl: text("sound_url").notNull(),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [index("soundboard_sounds_guild_idx").on(table.guildId)]
);

// ── User Soundboard Favorites ──
export const userSoundboardFavorites = mysqlTable(
  "user_soundboard_favorites",
  {
    userId: varchar("user_id", { length: 64 }).notNull(),
    soundId: varchar("sound_id", { length: 64 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.soundId] })]
);

// ── Voice Channel Spatial Positions ──
export const voiceSpatialPositions = mysqlTable(
  "voice_spatial_positions",
  {
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    channelId: varchar("channel_id", { length: 64 }).notNull(),
    x: int("x").notNull().default(0),
    y: int("y").notNull().default(0),
    z: int("z").notNull().default(0),
    updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.userId, table.channelId] }),
    index("voice_spatial_channel_idx").on(table.channelId),
  ]
);
