import Redis from "ioredis";
import { env } from "./env.js";

export const redisPub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
export const redisSub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
export const redis = redisPub;

redisPub.on("error", (err) => {
  console.error("[redis-pub] connection error:", err.message);
});

redisSub.on("error", (err) => {
  console.error("[redis-sub] connection error:", err.message);
});
