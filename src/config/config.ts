import { readFileSync, existsSync } from "fs";
import { env } from "./env.js";

interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

interface CorsConfig {
  origins: string[];
}

interface AppConfig {
  livekit: LiveKitConfig;
  cors: CorsConfig;
}

function loadConfigFile(): Partial<{
  livekit: Partial<LiveKitConfig>;
  cors: Partial<CorsConfig>;
}> {
  const configPath = process.env.CONFIG_PATH || "./config.json";
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

const file = loadConfigFile();

export const config: AppConfig = {
  livekit: {
    url: env.LIVEKIT_URL ?? file.livekit?.url ?? "ws://localhost:7880",
    apiKey: env.LIVEKIT_API_KEY ?? file.livekit?.apiKey ?? "",
    apiSecret: env.LIVEKIT_API_SECRET ?? file.livekit?.apiSecret ?? "",
  },
  cors: {
    origins: env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(",")
      : file.cors?.origins ?? ["http://localhost:3000"],
  },
};
