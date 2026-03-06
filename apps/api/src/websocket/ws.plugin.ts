import { FastifyPluginAsync } from 'fastify';

// Minimal WebSocket interface to avoid @types/ws version dependency
interface WsClient {
  readonly readyState: number;
  send(data: string): void;
}
const WS_OPEN = 1; // WebSocket.OPEN constant

// Connected clients indexed by companyId
const clients = new Map<string, Set<WsClient>>();

export function emitInventoryUpdate(payload: Record<string, unknown>): void {
  const message = JSON.stringify({ event: 'INVENTORY_UPDATE', data: payload, timestamp: new Date().toISOString() });
  clients.forEach((sockets) => {
    sockets.forEach((ws) => {
      if (ws.readyState === WS_OPEN) {
        ws.send(message);
      }
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

export const websocketPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', { websocket: true }, (socket, request) => {
    // On connect, client should send auth: { token: "..." }
    let companyId: string | null = null;

    socket.on('message', (rawMsg: Buffer | string) => {
      try {
        const msg = JSON.parse(rawMsg.toString()) as { type: string; token?: string; companyId?: string };

        if (msg.type === 'AUTH' && msg.companyId) {
          // In production: verify JWT token here
          companyId = msg.companyId;
          if (!clients.has(companyId)) clients.set(companyId, new Set());
          clients.get(companyId)!.add(socket);
          socket.send(JSON.stringify({ event: 'AUTH_OK', data: { companyId } }));
          return;
        }

        if (msg.type === 'PING') {
          socket.send(JSON.stringify({ event: 'PONG' }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on('close', () => {
      if (companyId && clients.has(companyId)) {
        clients.get(companyId)!.delete(socket);
        if (clients.get(companyId)!.size === 0) clients.delete(companyId);
      }
    });

    socket.on('error', () => {
      if (companyId && clients.has(companyId)) {
        clients.get(companyId)!.delete(socket);
      }
    });
  });
};
