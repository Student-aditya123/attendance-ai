/**
 * App.jsx — Root with React Router, auth bootstrap, DashboardLayout wrapper
 */
import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch, useSelector }  from 'react-redux';
import { setTokens, fetchMeThunk, selectRole, selectIsLoggedIn, selectInitialized } from './store/authSlice';
import { authAPI }    from './services/api';
import DashboardLayout from './components/layout/DashboardLayout';

const LoginPage      = lazy(() => import('./pages/Login'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const FacultyPanel   = lazy(() => import('./pages/faculty/Panel'));
const StudentPanel   = lazy(() => import('./pages/student/Panel'));
const StudentScanner = lazy(() => import('./pages/student/Scanner'));
const AnalyticsPage  = lazy(() => import('./pages/Analytics'));

const Spinner = () => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
    <div style={{ width:28, height:28, border:'2px solid #1c2840', borderTopColor:'#3d7fff', borderRadius:'50%', animation:'spin .8s linear infinite' }}/>
  </div>
);

function AuthBootstrap({ children }) {
  const dispatch    = useDispatch();
  const initialized = useSelector(selectInitialized);

  useEffect(() => {
    async function bootstrap() {
      try {
        const { data } = await authAPI.refresh();
        dispatch(setTokens({ accessToken: data.data.accessToken }));
        await dispatch(fetchMeThunk());
      } catch { 
        dispatch({ type: 'auth/setInitialized' }); 
      }
    }
    bootstrap();
  }, [dispatch]);

  if (!initialized) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#07090f' }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
        <div style={{ width:36, height:36, border:'3px solid #1c2840', borderTopColor:'#3d7fff', borderRadius:'50%', animation:'spin .8s linear infinite' }}/>
        <span style={{ fontSize:12, color:'#5a7098', fontFamily:"'Inter',sans-serif" }}>Loading AttendanceAI…</span>
      </div>
    </div>
  );

  return children;
}

function RequireAuth({ allowedRoles, children }) {
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const role       = useSelector(selectRole);

  if (!isLoggedIn)                  return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(role)) return <Navigate to="/403"   replace />;
  return children;
}

function AppRoutes() {
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const role       = useSelector(selectRole);
  const home = isLoggedIn ? (role==='admin'?'/admin/dashboard':role==='faculty'?'/faculty/dashboard':'/student/dashboard') : '/login';

  return (
    <Suspense fallback={<Spinner/>}>
      <Routes>
        <Route path="/login" element={<LoginPage/>}/>
        <Route path="/"      element={<Navigate to={home} replace/>}/>
        <Route element={<RequireAuth allowedRoles={['admin','faculty','student']}><DashboardLayout/></RequireAuth>}>
          <Route path="/admin/dashboard"   element={<RequireAuth allowedRoles={['admin']}><AdminDashboard/></RequireAuth>}/>
          <Route path="/admin/analytics"   element={<RequireAuth allowedRoles={['admin']}><AnalyticsPage/></RequireAuth>}/>
          <Route path="/admin/students"    element={<RequireAuth allowedRoles={['admin']}><AdminDashboard/></RequireAuth>}/>
          <Route path="/admin/security"    element={<RequireAuth allowedRoles={['admin']}><AdminDashboard/></RequireAuth>}/>
          <Route path="/faculty/dashboard" element={<RequireAuth allowedRoles={['faculty','admin']}><FacultyPanel/></RequireAuth>}/>
          <Route path="/faculty/session"   element={<RequireAuth allowedRoles={['faculty','admin']}><FacultyPanel/></RequireAuth>}/>
          <Route path="/faculty/analytics" element={<RequireAuth allowedRoles={['faculty','admin']}><AnalyticsPage/></RequireAuth>}/>
          <Route path="/student/dashboard" element={<RequireAuth allowedRoles={['student']}><StudentPanel/></RequireAuth>}/>
          <Route path="/student/scanner"   element={<RequireAuth allowedRoles={['student']}><StudentScanner/></RequireAuth>}/>
          <Route path="/student/analytics" element={<RequireAuth allowedRoles={['student']}><AnalyticsPage/></RequireAuth>}/>
        </Route>
        <Route path="/403" element={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#07090f',color:'#ff4d6d',fontSize:16,fontFamily:"'Inter',sans-serif"}}>403 — Access Denied</div>}/>
        <Route path="*"    element={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#07090f',color:'#5a7098',fontSize:16,fontFamily:"'Inter',sans-serif"}}>404 — Not Found</div>}/>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthBootstrap>
      <AppRoutes/>
    </AuthBootstrap>
  );
}