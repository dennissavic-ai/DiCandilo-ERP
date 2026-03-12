import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';

export interface VSMViewer {
  userId: string;
  userName: string;
}

interface UseVSMSyncResult {
  viewers: VSMViewer[];
  isConnected: boolean;
}

/**
 * Opens a persistent WebSocket connection to /api/v1/ws and provides:
 *  - Live invalidation of the active VSM map whenever another user saves a change (VSM_UPDATE)
 *  - Presence tracking — who else is currently viewing the same map (VSM_PRESENCE)
 *
 * The socket is reused across map selections; only a JOIN_MAP / LEAVE_MAP message
 * is sent when `mapId` changes, so navigation between maps is instant.
 */
export function useVSMSync(mapId: string | null): UseVSMSyncResult {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [viewers, setViewers] = useState<VSMViewer[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mapIdRef = useRef<string | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function send(ws: WebSocket, payload: object) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function joinMap(ws: WebSocket, id: string) {
    send(ws, { type: 'JOIN_MAP', mapId: id });
  }

  function leaveMap(ws: WebSocket) {
    send(ws, { type: 'LEAVE_MAP' });
  }

  // ── WS connection lifecycle ────────────────────────────────────────────────

  function connect() {
    if (!user || !accessToken || unmounted.current) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/v1/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmounted.current) { ws.close(); return; }
      setIsConnected(true);

      // Authenticate
      send(ws, {
        type: 'AUTH',
        companyId: user.companyId,
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        token: accessToken,
      });

      // Re-join current map if one is selected (handles reconnects)
      if (mapIdRef.current) joinMap(ws, mapIdRef.current);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as {
          event: string;
          data: Record<string, unknown>;
        };

        if (msg.event === 'VSM_UPDATE') {
          const { mapId: updatedMapId, action } = msg.data as {
            mapId: string;
            action: string;
          };
          // Always refresh the map list (updatedAt / node counts change)
          qc.invalidateQueries({ queryKey: ['vsm-maps'] });
          // Refresh the full map detail if it's the one currently open
          if (updatedMapId) {
            qc.invalidateQueries({ queryKey: ['vsm-map', updatedMapId] });
          }
          // If the currently-open map was deleted, clear the selection hint
          // (the page handles this via the stale vsm-maps list)
          void action; // consumed via cache invalidation above
        }

        if (msg.event === 'VSM_PRESENCE') {
          const { mapId: presenceMapId, viewers: incoming } = msg.data as {
            mapId: string;
            viewers: VSMViewer[];
          };
          // Only update presence state if this is for the map we're currently on
          if (presenceMapId === mapIdRef.current) {
            // Filter out ourselves from the presence list
            setViewers(incoming.filter((v) => v.userId !== user?.id));
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setViewers([]);
      wsRef.current = null;
      // Auto-reconnect after 3 s unless the component has unmounted
      if (!unmounted.current) {
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws.close(); // triggers onclose → reconnect
    };
  }

  // ── Mount / unmount ────────────────────────────────────────────────────────

  useEffect(() => {
    unmounted.current = false;
    connect();

    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on deliberate close
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
      setViewers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, accessToken]); // reconnect only if the logged-in user changes

  // ── Join / leave map room when selection changes ───────────────────────────

  useEffect(() => {
    mapIdRef.current = mapId;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (mapId) {
      joinMap(ws, mapId);
    } else {
      leaveMap(ws);
      setViewers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId]);

  return { viewers, isConnected };
}
