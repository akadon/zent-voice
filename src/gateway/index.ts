import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { URL } from "url";
import crypto from "crypto";
import { env } from "../config/env.js";
import { redisSub } from "../config/redis.js";
import * as voicestateService from "../services/voicestate.js";

const logger = {
  warn(msg: string, data?: Record<string, unknown>) {
    const entry = { level: "warn", time: Date.now(), name: "voice-gateway", msg, ...data };
    process.stderr.write(JSON.stringify(entry) + "\n");
  },
  error(msg: string, data?: Record<string, unknown>) {
    const entry = { level: "error", time: Date.now(), name: "voice-gateway", msg, ...data };
    process.stderr.write(JSON.stringify(entry) + "\n");
  },
};

interface VoiceGatewaySession {
  userId: string;
  sessionId: string;
  guildIds: string[];
}

const MAX_CONNECTIONS = 100_000;

function send(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── Room management ──

const guildRooms = new Map<string, Set<WebSocket>>();
const sessions = new Map<WebSocket, VoiceGatewaySession>();
const sessionsByUser = new Map<string, WebSocket>();

function addToGuild(guildId: string, ws: WebSocket) {
  let room = guildRooms.get(guildId);
  if (!room) { room = new Set(); guildRooms.set(guildId, room); }
  room.add(ws);
}

function removeFromGuild(guildId: string, ws: WebSocket) {
  const room = guildRooms.get(guildId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) guildRooms.delete(guildId);
  }
}

function broadcastToGuild(guildId: string, data: unknown) {
  const sockets = guildRooms.get(guildId);
  if (!sockets) return;
  const payload = JSON.stringify(data);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

export function createVoiceGateway(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 65_536,
    perMessageDeflate: false,
  });

  // Handle upgrade for /voice-gateway path
  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;
    if (pathname === "/voice-gateway") {
      if (sessions.size >= MAX_CONNECTIONS) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }

      // Extract token from query string for auth — only the internal API key is accepted
      // Direct client connections with user JWTs are not allowed; the main API server
      // proxies gateway connections on behalf of users.
      const url = new URL(request.url!, `http://${request.headers.host}`);
      const token = url.searchParams.get("token");
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const keyBuf = Buffer.from(env.INTERNAL_API_KEY);
      const tokenBuf = Buffer.from(token);
      const isInternalKey = keyBuf.length === tokenBuf.length && crypto.timingSafeEqual(keyBuf, tokenBuf);
      if (!isInternalKey) {
        logger.warn("WebSocket connection rejected: non-internal token", {
          ip: request.socket.remoteAddress,
        });
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  // Redis subscription for voice events
  redisSub.psubscribe("gateway:guild:*");
  redisSub.on("pmessage", async (_pattern, channel, message) => {
    try {
      const parsed = JSON.parse(message) as { event: string; data: unknown };
      const guildId = channel.replace("gateway:guild:", "");
      broadcastToGuild(guildId, { type: "voice_event", ...parsed });
    } catch (err) {
      logger.error("Failed to parse Redis gateway message", {
        channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  wss.on("connection", (ws: WebSocket, _request: any) => {
    let session: VoiceGatewaySession | null = null;

    ws.on("message", async (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as {
          type: string;
          data?: any;
        };

        switch (msg.type) {
          case "identify": {
            const data = msg.data as { userId: string; sessionId: string; guildIds: string[] };
            if (!data?.userId || !data?.sessionId || !Array.isArray(data?.guildIds)) {
              send(ws, { type: "error", code: 4001, message: "Invalid identify payload" });
              return;
            }

            // Connection is already authenticated as internal API key (enforced at upgrade).
            // Log suspicious guild list sizes for monitoring.
            const guildIds = data.guildIds.slice(0, 200);
            if (data.guildIds.length > 200) {
              logger.warn("Identify with excessive guildIds, truncated to 200", {
                userId: data.userId,
                originalCount: data.guildIds.length,
              });
            }

            session = { userId: data.userId, sessionId: data.sessionId, guildIds };
            sessions.set(ws, session);
            sessionsByUser.set(data.userId, ws);

            for (const guildId of guildIds) {
              addToGuild(guildId, ws);
            }

            send(ws, { type: "ready", sessionId: data.sessionId });
            break;
          }

          case "voice_state_update": {
            if (!session) return;
            const data = msg.data as {
              guildId: string;
              channelId: string | null;
              channelType?: number;
              username?: string;
              userLimit?: number | null;
              selfMute?: boolean;
              selfDeaf?: boolean;
            };

            if (!session.guildIds.includes(data.guildId)) {
              send(ws, { type: "error", code: 4003, message: "Not a member of this guild" });
              return;
            }

            if (data.channelId === null) {
              const previous = await voicestateService.leaveVoiceChannel(session.userId, data.guildId);
              if (previous) {
                broadcastToGuild(data.guildId, {
                  type: "voice_event",
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

              broadcastToGuild(data.guildId, {
                type: "voice_event",
                event: "VOICE_STATE_UPDATE",
                data: state,
              });

              send(ws, {
                type: "voice_server_update",
                guildId: data.guildId,
                token: state.livekitToken,
                endpoint: state.livekitUrl,
              });
            }
            break;
          }
        }
      } catch (err) {
        logger.error("Failed to parse or handle WebSocket message", {
          userId: session?.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    ws.on("close", async () => {
      if (!session) {
        sessions.delete(ws);
        return;
      }

      const disconnectedSession = session;
      session = null;
      sessions.delete(ws);

      // Atomic compare-and-delete: only remove from sessionsByUser if this ws
      // is still the current one (prevents race with a new connection for the same user)
      const currentWs = sessionsByUser.get(disconnectedSession.userId);
      if (currentWs !== ws) {
        // Another session already took over — just clean up rooms and return
        for (const guildId of disconnectedSession.guildIds) {
          removeFromGuild(guildId, ws);
        }
        return;
      }
      sessionsByUser.delete(disconnectedSession.userId);

      // Remove from rooms
      for (const guildId of disconnectedSession.guildIds) {
        removeFromGuild(guildId, ws);
      }

      // Batch cleanup
      const results = await Promise.allSettled(
        disconnectedSession.guildIds.map((guildId) =>
          voicestateService.leaveVoiceChannel(disconnectedSession.userId, guildId)
        )
      );

      for (let i = 0; i < disconnectedSession.guildIds.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled" && result.value) {
          const guildId = disconnectedSession.guildIds[i];
          broadcastToGuild(guildId, {
            type: "voice_event",
            event: "VOICE_STATE_UPDATE",
            data: { userId: disconnectedSession.userId, guildId, channelId: null, sessionId: disconnectedSession.sessionId },
          });
        }
      }
    });

    ws.on("error", (err) => {
      logger.error("WebSocket error", {
        userId: session?.userId,
        error: err.message,
      });
    });
  });

  return wss;
}
