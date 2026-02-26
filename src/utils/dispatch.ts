import { redisPub } from "../config/redis.js";

export async function dispatchGuild(guildId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  const now = Date.now();
  await Promise.all([
    redisPub.publish(`gateway:guild:${guildId}`, payload),
    // Event log for polling clients (60s retention)
    redisPub.zadd(`guild_events:${guildId}`, now, `${now}:${payload}`),
    redisPub.zremrangebyscore(`guild_events:${guildId}`, "-inf", now - 60000),
  ]);
}
