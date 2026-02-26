import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { URL } from "url";
import crypto from "crypto";
import { env } from "../config/env.js";
import { config } from "../config/config.js";
import { redisSub } from "../config/redis.js";
import * as voicestateService from "../services/voicestate.js";

interface VoiceGatewaySession {
  userId: string;
  sessionId: string;
  guildIds: string[];
}

function verifyToken(token: string): boolean {
  const keyBuf = Buffer.from(env.INTERNAL_API_KEY);
  const tokenBuf = Buffer.from(token);
  if (keyBuf.length === tokenBuf.length && crypto.timingSafeEqual(keyBuf, tokenBuf)) return true;

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

function extractUserId(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return payload.userId ?? null;
  } catch {
    return null;
  }
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

      // Extract token from query string for auth
      const url = new URL(request.url!, `http://${request.headers.host}`);
      const token = url.searchParams.get("token");
      if (!token || !verifyToken(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      (request as any).__token = token;
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
    } catch {
      // Ignore malformed messages
    }
  });

  wss.on("connection", (ws: WebSocket, request: any) => {
    let session: VoiceGatewaySession | null = null;
    const token = request.__token as string;

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

            // Validate userId matches token
            if (token !== env.INTERNAL_API_KEY) {
              const tokenUserId = extractUserId(token);
              if (tokenUserId && tokenUserId !== data.userId) {
                send(ws, { type: "error", code: 4002, message: "userId mismatch" });
                return;
              }
            }

            const guildIds = data.guildIds.slice(0, 200);
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
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", async () => {
      if (!session) {
        sessions.delete(ws);
        return;
      }

      const disconnectedSession = session;
      sessions.delete(ws);

      // Check if another session already took over for this user
      const currentWs = sessionsByUser.get(disconnectedSession.userId);
      if (currentWs && currentWs !== ws) return;
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

    ws.on("error", () => {});
  });

  return wss;
}
