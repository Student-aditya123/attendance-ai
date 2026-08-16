/**
 * hooks/useOfflineSync.js — Offline-first attendance marking
 *
 * Problem: Students are often in basements, labs, or areas with poor WiFi.
 * A failed QR scan during a lecture is a bad UX and an unfair absence mark.
 *
 * Solution — offline-first queue:
 *   1. Student scans QR code → immediately stored in IndexedDB
 *   2. UI shows "Queued — will sync when online"
 *   3. When connectivity restores → drain queue → POST to API
 *   4. Success → remove from queue; Failure → retry up to 3×
 *   5. After max retries → mark as failed (student notified to contact faculty)
 *
 * Why IndexedDB (via 'idb' library)?
 *   localStorage is synchronous and limited to ~5MB.
 *   IndexedDB is async, supports structured data, and survives tab refreshes.
 *   'idb' gives a clean Promise-based API over the raw IndexedDB callbacks.
 *
 * Security: queued records include the original JWT token at scan time.
 * The server validates token expiry on sync — expired tokens are rejected
 * and the student gets a clear error rather than a silent false-mark.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { openDB } from 'idb';
import { attendanceAPI } from '../services/api';

const DB_NAME    = 'attendance-offline';
const STORE_NAME = 'pending-scans';
const DB_VERSION = 1;
const MAX_RETRIES = 3;

// ── IndexedDB setup ───────────────────────────────────────────────────────────
async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath:       'id',
          autoIncrement: true,
        });
        store.createIndex('status',    'status');
        store.createIndex('createdAt', 'createdAt');
      }
    },
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useOfflineSync() {
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing,    setIsSyncing]    = useState(false);
  const syncInProgress = useRef(false);

  // ── Track online / offline ─────────────────────────────────────────────────
  useEffect(() => {
    const onOnline  = () => { setIsOnline(true);  syncQueue(); };
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    updatePendingCount();

    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ── Queue a scan for later submission ─────────────────────────────────────
  const queueScan = useCallback(async (scanData) => {
    const db = await getDB();
    await db.add(STORE_NAME, {
      ...scanData,
      status:     'pending',
      retries:    0,
      createdAt:  Date.now(),
      queuedAt:   new Date().toISOString(),
    });
    await updatePendingCount();

    // If we're actually online, try to sync immediately
    if (navigator.onLine) syncQueue();
  }, []);

  // ── Drain the queue ────────────────────────────────────────────────────────
  const syncQueue = useCallback(async () => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    setIsSyncing(true);

    try {
      const db      = await getDB();
      const pending = await db.getAllFromIndex(STORE_NAME, 'status', 'pending');

      for (const record of pending) {
        if (record.retries >= MAX_RETRIES) {
          // Mark as permanently failed — faculty manual override needed
          await db.put(STORE_NAME, { ...record, status: 'failed' });
          continue;
        }

        try {
          await attendanceAPI.markViaQR({
            sessionId:    record.sessionId,
            scannedToken: record.scannedToken,
            latitude:     record.latitude,
            longitude:    record.longitude,
          });

          // Success → remove from queue
          await db.delete(STORE_NAME, record.id);
        } catch (err) {
          if (err.status === 409) {
            // 409 = already marked — safe to remove
            await db.delete(STORE_NAME, record.id);
          } else if (err.status === 422) {
            // Validation error (expired token, location mismatch) — won't succeed on retry
            await db.put(STORE_NAME, {
              ...record,
              status:       'failed',
              failReason:   err.message,
            });
          } else {
            // Network/server error — increment retry count
            await db.put(STORE_NAME, {
              ...record,
              retries:      record.retries + 1,
              lastAttempt:  Date.now(),
            });
          }
        }
      }
    } finally {
      syncInProgress.current = false;
      setIsSyncing(false);
      await updatePendingCount();
    }
  }, []);

  // ── Get all pending/failed records ─────────────────────────────────────────
  const getPendingRecords = useCallback(async () => {
    const db = await getDB();
    return db.getAllFromIndex(STORE_NAME, 'status', 'pending');
  }, []);

  const getFailedRecords = useCallback(async () => {
    const db = await getDB();
    return db.getAllFromIndex(STORE_NAME, 'status', 'failed');
  }, []);

  // ── Clear synced records older than 7 days ─────────────────────────────────
  const cleanup = useCallback(async () => {
    const db        = await getDB();
    const all       = await db.getAll(STORE_NAME);
    const cutoff    = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stale     = all.filter(r => r.status === 'synced' && r.createdAt < cutoff);
    await Promise.all(stale.map(r => db.delete(STORE_NAME, r.id)));
  }, []);

  async function updatePendingCount() {
    try {
      const db      = await getDB();
      const pending = await db.getAllFromIndex(STORE_NAME, 'status', 'pending');
      setPendingCount(pending.length);
    } catch {
      setPendingCount(0);
    }
  }

  return {
    isOnline, isSyncing, pendingCount,
    queueScan, syncQueue,
    getPendingRecords, getFailedRecords,
    cleanup,
  };
}
