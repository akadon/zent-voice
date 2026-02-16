import { redisPub } from "../config/redis.js";

export async function dispatchGuild(guildId: string, event: string, data: unknown) {
  await redisPub.publish(
    `gateway:guild:${guildId}`,
    JSON.stringify({ event, data })
  );
}
