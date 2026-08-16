/**
 * store/index.js — Redux store configuration
 *
 * Exported as a named `store` so the Axios interceptor (outside React)
 * can call store.getState() and store.dispatch() directly.
 */
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
  },

  middleware: (getDefault) =>
    getDefault({
      // Access tokens are non-serializable (JWTs are strings, so this is fine)
      // but disable the check for any future Date/function values
      serializableCheck: {
        ignoredActions: ['auth/setTokens'],
      },
    }),

  devTools: import.meta.env.DEV,
});
