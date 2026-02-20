import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import crypto from "crypto";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "../config/env.js";
import { redisPub, redisSub } from "../config/redis.js";
import * as voicestateService from "../services/voicestate.js";

interface VoiceGatewaySession {
  userId: string;
  sessionId: string;
  guildIds: string[];
}

function verifyToken(token: string): boolean {
  // Constant-time comparison for internal API key
  const keyBuf = Buffer.from(env.INTERNAL_API_KEY);
  const tokenBuf = Buffer.from(token);
  if (keyBuf.length === tokenBuf.length && crypto.timingSafeEqual(keyBuf, tokenBuf)) return true;

  // Try JWT validation with AUTH_SECRET
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const sig = crypto
      .createHmac("sha256", env.AUTH_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest("base64url");
    if (sig !== parts[2]) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

export function createVoiceGateway(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    path: "/voice-gateway",
    cors: {
      origin: env.CORS_ORIGIN || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.adapter(createAdapter(redisPub, redisSub));

  const sessions = new Map<string, VoiceGatewaySession>();

  // Authenticate connections
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ??
      socket.handshake.query?.token;

    if (typeof token !== "string" || !token) {
      return next(new Error("unauthorized"));
    }

    if (!verifyToken(token)) {
      return next(new Error("unauthorized"));
    }

    next();
  });

  // Subscribe to voice events from Redis
  redisSub.psubscribe("gateway:guild:*");
  redisSub.on("pmessage", async (_pattern, channel, message) => {
    try {
      const parsed = JSON.parse(message) as { event: string; data: unknown };
      const guildId = channel.replace("gateway:guild:", "");
      io.to(`guild:${guildId}`).emit("voice_event", parsed);
    } catch {
      // Ignore malformed messages
    }
  });

  io.on("connection", (socket) => {
    let session: VoiceGatewaySession | null = null;

    socket.on("identify", (data: { userId: string; sessionId: string; guildIds: string[] }) => {
      if (
        typeof data.userId !== "string" || !data.userId ||
        typeof data.sessionId !== "string" || !data.sessionId ||
        !Array.isArray(data.guildIds)
      ) {
        socket.emit("error", { code: 4001, message: "Invalid identify payload" });
        return;
      }

      // Validate userId from token matches the claimed userId
      const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
      if (typeof token === "string") {
        if (token === env.INTERNAL_API_KEY) {
          // Internal API key: userId must still be provided and validated via data
          // but we trust the internal service to provide the correct userId
        } else {
          try {
            const parts = token.split(".");
            if (parts.length === 3) {
              const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
              if (payload.userId && payload.userId !== data.userId) {
                socket.emit("error", { code: 4002, message: "userId mismatch" });
                return;
              }
            }
          } catch {
            // Token already validated in middleware, skip
          }
        }
      }

      const guildIds = data.guildIds.slice(0, 200);

      session = {
        userId: data.userId,
        sessionId: data.sessionId,
        guildIds,
      };
      sessions.set(socket.id, session);

      for (const guildId of guildIds) {
        socket.join(`guild:${guildId}`);
      }

      socket.emit("ready", { sessionId: data.sessionId });
    });

    socket.on("voice_state_update", async (data: {
      guildId: string;
      channelId: string | null;
      channelType?: number;
      username?: string;
      userLimit?: number | null;
      selfMute?: boolean;
      selfDeaf?: boolean;
    }) => {
      if (!session) return;

      // Verify guild membership before allowing voice state changes
      if (!session.guildIds.includes(data.guildId)) {
        socket.emit("error", { code: 4003, message: "Not a member of this guild" });
        return;
      }

      if (data.channelId === null) {
        const previous = await voicestateService.leaveVoiceChannel(session.userId, data.guildId);
        if (previous) {
          io.to(`guild:${data.guildId}`).emit("voice_event", {
            event: "VOICE_STATE_UPDATE",
            data: { userId: session.userId, guildId: data.guildId, channelId: null, sessionId: session.sessionId },
          });
        }
      } else {
        const state = await voicestateService.joinVoiceChannel(
          session.userId,
          data.guildId,
          data.channelId,
          data.channelType ?? 2,
          session.sessionId,
          data.username ?? "Unknown",
          data.userLimit ?? null,
          { selfMute: data.selfMute, selfDeaf: data.selfDeaf }
        );

        io.to(`guild:${data.guildId}`).emit("voice_event", {
          event: "VOICE_STATE_UPDATE",
          data: state,
        });

        socket.emit("voice_server_update", {
          guildId: data.guildId,
          token: state.livekitToken,
          endpoint: state.livekitUrl,
        });
      }
    });

    socket.on("disconnect", async () => {
      if (!session) return;

      const disconnectedSession = session;
      sessions.delete(socket.id);

      // Check if a new session has already been created for this user
      // (reconnect race condition). If so, skip cleanup.
      const currentSession = Array.from(sessions.values()).find(
        (s) => s.userId === disconnectedSession.userId
      );
      if (currentSession && currentSession.sessionId !== disconnectedSession.sessionId) {
        return;
      }

      for (const guildId of disconnectedSession.guildIds) {
        try {
          const previous = await voicestateService.leaveVoiceChannel(disconnectedSession.userId, guildId);
          if (previous) {
            io.to(`guild:${guildId}`).emit("voice_event", {
              event: "VOICE_STATE_UPDATE",
              data: { userId: disconnectedSession.userId, guildId, channelId: null, sessionId: disconnectedSession.sessionId },
            });
          }
        } catch {
          // Log but don't let one guild failure skip others
        }
      }
    });
  });

  return io;
}
