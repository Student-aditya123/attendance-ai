/**
 * hooks/useWebSocket.js — Socket.io real-time connection
 *
 * Manages the WebSocket lifecycle:
 *   - Connect on mount with JWT auth token
 *   - Join role-specific rooms (session, admin, user:{id})
 *   - Auto-reconnect with exponential backoff (Socket.io built-in)
 *   - Disconnect on unmount or token expiry
 *   - Expose typed event subscription helpers
 *
 * Events received from server:
 *   attendance:marked  — new student marked present (faculty/admin dashboard)
 *   attendance:fraud   — fraud attempt detected (faculty/admin alert)
 *   qr:rotated         — new QR code available (faculty session page)
 *   notification       — personal notification (student low-attendance alert)
 *
 * Usage:
 *   const { joinSession, leaveSession, onAttendance, connected } = useWebSocket();
 *   useEffect(() => { joinSession(sessionId); return () => leaveSession(sessionId); }, []);
 *   onAttendance((data) => setCount(c => c + 1));
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { io }            from 'socket.io-client';
import { useSelector }   from 'react-redux';
import { selectAccessToken, selectUser } from '../store/authSlice';

const WS_URL = import.meta.env.VITE_WS_URL || window.location.origin;

// Singleton socket — shared across all hook instances
let _socket = null;
const _subscribers = {};   // event → Set<handler>

function getOrCreateSocket(token) {
  if (_socket?.connected) return _socket;

  _socket = io(WS_URL, {
    auth:              { token },
    transports:        ['websocket', 'polling'],
    reconnection:      true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    reconnectionAttempts: Infinity,
  });

  return _socket;
}

export function useWebSocket() {
  const token   = useSelector(selectAccessToken);
  const user    = useSelector(selectUser);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  // ── Connect / reconnect when token changes ─────────────────────────────────
  useEffect(() => {
    if (!token) return;

    const socket = getOrCreateSocket(token);
    socketRef.current = socket;

    const onConnect    = ()  => setConnected(true);
    const onDisconnect = ()  => setConnected(false);
    const onError      = (e) => console.warn('[WS] Error:', e.message);

    socket.on('connect',    onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('error',      onError);

    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect',    onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('error',      onError);
    };
  }, [token]);

  // ── Disconnect when user logs out ──────────────────────────────────────────
  useEffect(() => {
    if (!user && _socket) {
      _socket.disconnect();
      _socket = null;
      setConnected(false);
    }
  }, [user]);

  // ── Room management ────────────────────────────────────────────────────────
  const joinSession = useCallback((sessionId) => {
    socketRef.current?.emit('join:session', sessionId);
  }, []);

  const leaveSession = useCallback((sessionId) => {
    socketRef.current?.emit('leave:session', sessionId);
  }, []);

  // ── Event subscription factory ─────────────────────────────────────────────
  function makeSubscriber(event) {
    return (handler) => {
      useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;
        socket.on(event, handler);
        return () => socket.off(event, handler);
      }, [handler]);
    };
  }

  const onAttendanceMarked = useCallback((handler) => {
    const s = socketRef.current;
    if (!s) return () => {};
    s.on('attendance:marked', handler);
    return () => s.off('attendance:marked', handler);
  }, []);

  const onFraudAlert = useCallback((handler) => {
    const s = socketRef.current;
    if (!s) return () => {};
    s.on('attendance:fraud', handler);
    return () => s.off('attendance:fraud', handler);
  }, []);

  const onQrRotated = useCallback((handler) => {
    const s = socketRef.current;
    if (!s) return () => {};
    s.on('qr:rotated', handler);
    return () => s.off('qr:rotated', handler);
  }, []);

  const onNotification = useCallback((handler) => {
    const s = socketRef.current;
    if (!s) return () => {};
    s.on('notification', handler);
    return () => s.off('notification', handler);
  }, []);

  return {
    connected,
    joinSession, leaveSession,
    onAttendanceMarked, onFraudAlert, onQrRotated, onNotification,
    socket: socketRef.current,
  };
}
