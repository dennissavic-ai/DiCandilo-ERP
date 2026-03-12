import { FastifyPluginAsync } from 'fastify';

// Minimal WebSocket interface to avoid @types/ws version dependency
interface WsClient {
  readonly readyState: number;
  send(data: string): void;
}
const WS_OPEN = 1; // WebSocket.OPEN constant

interface ClientMeta {
  companyId: string | null;
  userId: string | null;
  userName: string | null;
  currentMapId: string | null;
}

// Connected clients indexed by companyId
const clients = new Map<string, Set<WsClient>>();

// Clients currently viewing a specific VSM map
const mapViewers = new Map<string, Set<WsClient>>();

// Per-socket metadata (userId, companyId, currentMapId)
const clientMeta = new Map<WsClient, ClientMeta>();

// ── Broadcast helpers ──────────────────────────────────────────────────────────

export function emitInventoryUpdate(payload: Record<string, unknown>): void {
  const message = JSON.stringify({ event: 'INVENTORY_UPDATE', data: payload, timestamp: new Date().toISOString() });
  clients.forEach((sockets) => {
    sockets.forEach((ws) => {
      if (ws.readyState === WS_OPEN) ws.send(message);
    });
  });
}

export function emitToCompany(companyId: string, event: string, data: unknown): void {
  const sockets = clients.get(companyId);
  if (!sockets) return;
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  sockets.forEach((ws) => {
    if (ws.readyState === WS_OPEN) ws.send(message);
  });
}

/** Broadcast to all sockets currently viewing a specific VSM map. */
export function emitToMapViewers(
  mapId: string,
  event: string,
  data: unknown,
  exclude?: WsClient,
): void {
  const sockets = mapViewers.get(mapId);
  if (!sockets) return;
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  sockets.forEach((ws) => {
    if (ws !== exclude && ws.readyState === WS_OPEN) ws.send(message);
  });
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function broadcastPresence(mapId: string): void {
  const sockets = mapViewers.get(mapId);
  const viewers = sockets
    ? Array.from(sockets)
        .map((ws) => clientMeta.get(ws))
        .filter((m): m is ClientMeta => m != null && m.userId != null)
        .map((m) => ({ userId: m.userId!, userName: m.userName ?? 'Unknown' }))
    : [];

  const message = JSON.stringify({
    event: 'VSM_PRESENCE',
    data: { mapId, viewers },
    timestamp: new Date().toISOString(),
  });

  // Send to every viewer of this map (presence update is for all, not just new joiner)
  sockets?.forEach((ws) => {
    if (ws.readyState === WS_OPEN) ws.send(message);
  });
}

function leaveMap(socket: WsClient): void {
  const meta = clientMeta.get(socket);
  if (!meta?.currentMapId) return;
  const mapId = meta.currentMapId;
  mapViewers.get(mapId)?.delete(socket);
  if (mapViewers.get(mapId)?.size === 0) mapViewers.delete(mapId);
  meta.currentMapId = null;
  broadcastPresence(mapId);
}

function removeClient(socket: WsClient): void {
  leaveMap(socket);
  const meta = clientMeta.get(socket);
  if (meta?.companyId) {
    clients.get(meta.companyId)?.delete(socket);
    if (clients.get(meta.companyId)?.size === 0) clients.delete(meta.companyId);
  }
  clientMeta.delete(socket);
}

// ── Plugin ─────────────────────────────────────────────────────────────────────

export const websocketPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', { websocket: true }, (socket, _request) => {
    const meta: ClientMeta = { companyId: null, userId: null, userName: null, currentMapId: null };
    clientMeta.set(socket, meta);

    socket.on('message', (rawMsg: Buffer | string) => {
      try {
        const msg = JSON.parse(rawMsg.toString()) as {
          type: string;
          token?: string;
          companyId?: string;
          userId?: string;
          userName?: string;
          mapId?: string;
        };

        // ── AUTH ──────────────────────────────────────────────────────────────
        if (msg.type === 'AUTH' && msg.companyId) {
          // In production: verify JWT token here via fastify.jwt.verify(msg.token)
          meta.companyId = msg.companyId;
          meta.userId = msg.userId ?? null;
          meta.userName = msg.userName ?? 'Unknown';

          if (!clients.has(meta.companyId)) clients.set(meta.companyId, new Set());
          clients.get(meta.companyId)!.add(socket);

          socket.send(JSON.stringify({
            event: 'AUTH_OK',
            data: { companyId: meta.companyId, userId: meta.userId },
          }));
          return;
        }

        // ── PING ──────────────────────────────────────────────────────────────
        if (msg.type === 'PING') {
          socket.send(JSON.stringify({ event: 'PONG' }));
          return;
        }

        // Remaining messages require an authenticated session
        if (!meta.companyId) return;

        // ── JOIN_MAP — subscribe to a specific VSM map room ───────────────────
        if (msg.type === 'JOIN_MAP' && msg.mapId) {
          // Leave any previous map first
          leaveMap(socket);

          meta.currentMapId = msg.mapId;
          if (!mapViewers.has(msg.mapId)) mapViewers.set(msg.mapId, new Set());
          mapViewers.get(msg.mapId)!.add(socket);

          broadcastPresence(msg.mapId);
          return;
        }

        // ── LEAVE_MAP — unsubscribe from current VSM map room ─────────────────
        if (msg.type === 'LEAVE_MAP') {
          leaveMap(socket);
          return;
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on('close', () => removeClient(socket));
    socket.on('error', () => removeClient(socket));
  });
};
