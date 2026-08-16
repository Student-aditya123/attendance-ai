/**
 * services/api.js — Axios HTTP client with automatic token refresh
 *
 * Key behaviours:
 *
 * 1. ACCESS TOKEN INJECTION
 *    Every request automatically gets `Authorization: Bearer <token>` from
 *    the Redux store. Components never touch tokens directly.
 *
 * 2. SILENT TOKEN REFRESH
 *    When any request returns 401 (token expired), the interceptor:
 *      a) Queues the original request
 *      b) Calls POST /auth/refresh (uses httpOnly cookie — no token needed)
 *      c) Stores the new access token in Redux
 *      d) Replays ALL queued requests with the new token
 *    Result: users never see a session expired error during normal use.
 *
 * 3. QUEUE DRAINING
 *    If refresh is already in flight (concurrent 401s), subsequent requests
 *    wait on a promise queue rather than each triggering their own refresh.
 *
 * 4. DEVICE FINGERPRINT
 *    Each request includes X-Device-Fingerprint for fraud detection.
 *    The fingerprint is a hash of stable browser properties.
 */
import axios from 'axios';
import { store } from '../store';
import { setTokens, clearAuth } from '../store/authSlice';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

// ── Device fingerprint (stable across tab sessions) ───────────────────────────
const deviceFingerprint = (() => {
  const nav = window.navigator;
  const raw = [
    nav.userAgent, nav.language, nav.platform,
    screen.width, screen.height, screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');

  // Simple djb2 hash — sufficient for fraud detection correlation
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
})();

// ── Axios instance ─────────────────────────────────────────────────────────────
export const api = axios.create({
  baseURL:         BASE_URL,
  timeout:         15_000,
  withCredentials: true,      // required for httpOnly refresh token cookie
  headers: {
    'Content-Type':       'application/json',
    'X-Device-Fingerprint': deviceFingerprint,
  },
});

// ── Request interceptor: inject access token ──────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const { accessToken } = store.getState().auth;
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor: handle 401 → silent refresh ────────────────────────
let isRefreshing = false;
let failedQueue  = [];    // [{resolve, reject}]

function processQueue(error, token = null) {
  failedQueue.forEach(({ resolve, reject }) => {
    error ? reject(error) : resolve(token);
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,

  async (error) => {
    const original = error.config;

    // Not a 401, or already retried, or it's the refresh endpoint itself
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(_normaliseError(error));
    }

    if (isRefreshing) {
      // Another refresh is in flight — queue this request
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    original._retry  = true;
    isRefreshing     = true;

    try {
      const { data } = await api.post('/auth/refresh');
      const newToken  = data.data.accessToken;

      store.dispatch(setTokens({ accessToken: newToken }));
      original.headers.Authorization = `Bearer ${newToken}`;
      processQueue(null, newToken);

      return api(original);
    } catch (refreshError) {
      processQueue(refreshError, null);
      store.dispatch(clearAuth());
      window.location.replace('/login');
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

// ── Error normalisation ────────────────────────────────────────────────────────
function _normaliseError(error) {
  if (error.response) {
    const { status, data } = error.response;
    const message = data?.message || data?.detail || `HTTP ${status}`;
    const e = new Error(message);
    e.status = status;
    e.errors = data?.errors;     // Zod validation field errors
    return e;
  }
  if (error.request) {
    const e = new Error('Network error — check your connection');
    e.status = 0;
    return e;
  }
  return error;
}

// ── Typed API helpers ──────────────────────────────────────────────────────────
export const authAPI = {
  register:       (data)           => api.post('/auth/register', data),
  login:          (data)           => api.post('/auth/login', data),
  logout:         ()               => api.post('/auth/logout'),
  refresh:        ()               => api.post('/auth/refresh'),
  me:             ()               => api.get('/auth/me'),
  changePassword: (data)           => api.put('/auth/change-password', data),
};

export const attendanceAPI = {
  createSession:      (data)           => api.post('/attendance/sessions', data),
  rotateToken:        (sessionId)      => api.post(`/attendance/sessions/${sessionId}/rotate`),
  endSession:         (sessionId)      => api.delete(`/attendance/sessions/${sessionId}`),
  getSession:         (sessionId)      => api.get(`/attendance/sessions/${sessionId}`),
  markManual:         (sessionId, data)=> api.put(`/attendance/sessions/${sessionId}/manual`, data),
  markViaQR:          (data)           => api.post('/attendance/mark/qr', data),
  markViaFace:        (data)           => api.post('/attendance/mark/face', data),
  getStudentSummary:  (studentId, q)   => api.get(`/attendance/students/${studentId}/summary`, { params: q }),
};

export const analyticsAPI = {
  adminOverview:  (params)         => api.get('/analytics/admin/overview', { params }),
  atRisk:         (params)         => api.get('/analytics/admin/at-risk', { params }),
  departments:    ()               => api.get('/analytics/admin/departments'),
  facultyClasses: ()               => api.get('/analytics/faculty/classes'),
  heatmap:        (classId, p)     => api.get(`/analytics/heatmap/${classId}`, { params: p }),
  leaderboard:    (params)         => api.get('/analytics/leaderboard', { params }),
  exportClass:    (classId, p)     => api.get(`/analytics/export/${classId}`, { params: p, responseType: 'blob' }),
};

export default api;
