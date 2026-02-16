import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

// ── Voice States ──
export const voiceStates = pgTable(
  "voice_states",
  {
    userId: text("user_id").notNull(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id"),
    sessionId: text("session_id").notNull(),
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
export const stageInstances = pgTable(
  "stage_instances",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    topic: text("topic").notNull(),
    privacyLevel: integer("privacy_level").notNull().default(2),
    guildScheduledEventId: text("guild_scheduled_event_id"),
    discoverableDisabled: boolean("discoverable_disabled").notNull().default(false),
  },
  (table) => [
    index("stage_instances_guild_idx").on(table.guildId),
  ]
);

// ── Soundboard Sounds ──
export const soundboardSounds = pgTable(
  "soundboard_sounds",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    volume: integer("volume").notNull().default(100),
    emojiId: text("emoji_id"),
    emojiName: text("emoji_name"),
    userId: text("user_id"),
    available: boolean("available").notNull().default(true),
    soundUrl: text("sound_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("soundboard_sounds_guild_idx").on(table.guildId)]
);

// ── User Soundboard Favorites ──
export const userSoundboardFavorites = pgTable(
  "user_soundboard_favorites",
  {
    userId: text("user_id").notNull(),
    soundId: text("sound_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.soundId] })]
);

// ── Voice Channel Spatial Positions ──
export const voiceSpatialPositions = pgTable(
  "voice_spatial_positions",
  {
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    channelId: text("channel_id").notNull(),
    x: integer("x").notNull().default(0),
    y: integer("y").notNull().default(0),
    z: integer("z").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.userId, table.channelId] }),
    index("voice_spatial_channel_idx").on(table.channelId),
  ]
);
