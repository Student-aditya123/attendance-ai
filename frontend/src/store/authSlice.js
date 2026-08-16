/**
 * store/authSlice.js — Redux Toolkit slice for authentication state
 *
 * Why Redux for auth (not just React context)?
 *   The access token needs to be accessible from the Axios interceptor
 *   (services/api.js) which lives outside the React tree.
 *   Redux gives a single store that both the interceptor and components can read.
 *
 * What lives here:
 *   - accessToken  (in-memory only — NEVER written to localStorage)
 *   - user profile (name, email, role, department)
 *   - loading state (for login/register spinners)
 *   - error messages
 *
 * What does NOT live here:
 *   - refresh token (lives in httpOnly cookie — JS can't read it)
 *   - password (never stored)
 */
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { authAPI } from '../services/api';

// ── Async thunks ──────────────────────────────────────────────────────────────

export const loginThunk = createAsyncThunk(
  'auth/login',
  async (credentials, { rejectWithValue }) => {
    try {
      const { data } = await authAPI.login(credentials);
      return data.data;  // { user, accessToken }
    } catch (err) {
      return rejectWithValue(err.message || 'Login failed');
    }
  }
);

export const registerThunk = createAsyncThunk(
  'auth/register',
  async (userData, { rejectWithValue }) => {
    try {
      const { data } = await authAPI.register(userData);
      return data.data;
    } catch (err) {
      return rejectWithValue(err.message || 'Registration failed');
    }
  }
);

export const logoutThunk = createAsyncThunk(
  'auth/logout',
  async (_, { dispatch }) => {
    try {
      await authAPI.logout();
    } finally {
      dispatch(clearAuth());
    }
  }
);

export const fetchMeThunk = createAsyncThunk(
  'auth/fetchMe',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await authAPI.me();
      return data.data.user;
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

// ── Slice ─────────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',

  initialState: {
    user:        null,
    accessToken: null,
    isLoading:   false,
    error:       null,
    initialized: false,   // true after first /auth/me check on app load
  },

  reducers: {
    setTokens(state, { payload }) {
      state.accessToken = payload.accessToken;
      if (payload.user) state.user = payload.user;
    },

    clearAuth(state) {
      state.user        = null;
      state.accessToken = null;
      state.error       = null;
    },

    clearError(state) {
      state.error = null;
    },

    setInitialized(state) {
      state.initialized = true;
    },
  },

  extraReducers: (builder) => {
    // ── login ────────────────────────────────────────────────────────────────
    builder
      .addCase(loginThunk.pending,   (state) => { state.isLoading = true; state.error = null; })
      .addCase(loginThunk.fulfilled, (state, { payload }) => {
        state.isLoading  = false;
        state.user        = payload.user;
        state.accessToken = payload.accessToken;
      })
      .addCase(loginThunk.rejected,  (state, { payload }) => {
        state.isLoading = false;
        state.error      = payload;
      });

    // ── register ─────────────────────────────────────────────────────────────
    builder
      .addCase(registerThunk.pending,   (state) => { state.isLoading = true; state.error = null; })
      .addCase(registerThunk.fulfilled, (state, { payload }) => {
        state.isLoading  = false;
        state.user        = payload.user;
        state.accessToken = payload.accessToken;
      })
      .addCase(registerThunk.rejected,  (state, { payload }) => {
        state.isLoading = false;
        state.error      = payload;
      });

    // ── fetchMe ──────────────────────────────────────────────────────────────
    builder
      .addCase(fetchMeThunk.fulfilled, (state, { payload }) => {
        state.user        = payload;
        state.initialized = true;
      })
      .addCase(fetchMeThunk.rejected, (state) => {
        state.initialized = true;   // even on failure — we know user is logged out
      });
  },
});

export const { setTokens, clearAuth, clearError, setInitialized } = authSlice.actions;

// ── Selectors ─────────────────────────────────────────────────────────────────
export const selectUser        = (s) => s.auth.user;
export const selectRole        = (s) => s.auth.user?.role;
export const selectAccessToken = (s) => s.auth.accessToken;
export const selectIsLoggedIn  = (s) => !!s.auth.accessToken && !!s.auth.user;
export const selectAuthLoading = (s) => s.auth.isLoading;
export const selectAuthError   = (s) => s.auth.error;
export const selectInitialized = (s) => s.auth.initialized;

export default authSlice.reducer;
