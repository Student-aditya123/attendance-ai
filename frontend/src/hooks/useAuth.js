/**
 * hooks/useAuth.js — Authentication hook
 *
 * Provides:
 *   user, role, isLoggedIn  — current auth state
 *   login(email, password)  — dispatches loginThunk, returns { success, error }
 *   register(data)          — dispatches registerThunk
 *   logout()                — dispatches logoutThunk, redirects to /login
 *   requireRole(...roles)   — returns true if user has one of the given roles
 *
 * Usage:
 *   const { user, login, requireRole } = useAuth();
 *   if (!requireRole('faculty', 'admin')) return <Navigate to="/403" />;
 */
import { useCallback }    from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate }    from 'react-router-dom';
import {
  loginThunk, registerThunk, logoutThunk,
  selectUser, selectRole, selectIsLoggedIn,
  selectAuthLoading, selectAuthError, clearError,
} from '../store/authSlice';

export function useAuth() {
  const dispatch   = useDispatch();
  const navigate   = useNavigate();

  const user      = useSelector(selectUser);
  const role      = useSelector(selectRole);
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const isLoading  = useSelector(selectAuthLoading);
  const error      = useSelector(selectAuthError);

  const login = useCallback(async (email, password) => {
    const result = await dispatch(loginThunk({ email, password }));
    if (loginThunk.fulfilled.match(result)) {
      const userRole = result.payload.user.role;
      navigate(roleHomeRoute(userRole), { replace: true });
      return { success: true };
    }
    return { success: false, error: result.payload };
  }, [dispatch, navigate]);

  const register = useCallback(async (data) => {
    const result = await dispatch(registerThunk(data));
    if (registerThunk.fulfilled.match(result)) {
      const userRole = result.payload.user.role;
      navigate(roleHomeRoute(userRole), { replace: true });
      return { success: true };
    }
    return { success: false, error: result.payload };
  }, [dispatch, navigate]);

  const logout = useCallback(async () => {
    await dispatch(logoutThunk());
    navigate('/login', { replace: true });
  }, [dispatch, navigate]);

  const dismissError = useCallback(() => {
    dispatch(clearError());
  }, [dispatch]);

  const requireRole = useCallback((...roles) => {
    return roles.includes(role);
  }, [role]);

  return {
    user, role, isLoggedIn, isLoading, error,
    login, register, logout, dismissError, requireRole,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────
function roleHomeRoute(role) {
  const routes = {
    admin:   '/admin/dashboard',
    faculty: '/faculty/dashboard',
    student: '/student/dashboard',
  };
  return routes[role] || '/';
}
