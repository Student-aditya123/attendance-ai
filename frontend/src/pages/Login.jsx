/**
 * pages/Login.jsx
 *
 * Responsibilities:
 *   - Role picker (admin / faculty / student)
 *   - Email + password form
 *   - Dispatch loginThunk → on success, navigate to role home
 *   - Surface validation errors inline (Zod errors from the API)
 *   - Pre-fill demo credentials on role switch (dev convenience)
 */
import { useState, useEffect } from 'react';
import { useNavigate }         from 'react-router-dom';
import { useSelector }         from 'react-redux';
import { Activity, Lock, Shield, BookOpen, Users, Eye, EyeOff } from 'lucide-react';
import { useAuth }             from '../hooks/useAuth';
import { selectIsLoggedIn, selectRole } from '../store/authSlice';

const ROLES = [
  { id: 'admin',   icon: Shield,   label: 'Admin',   color: '#9d6fff', bg: 'rgba(157,111,255,.13)', desc: 'System oversight' },
  { id: 'faculty', icon: BookOpen, label: 'Faculty', color: '#3d7fff', bg: 'rgba(61,127,255,.13)',  desc: 'Manage lectures'  },
  { id: 'student', icon: Users,    label: 'Student', color: '#00c48c', bg: 'rgba(0,196,140,.13)',   desc: 'Track attendance' },
];

const DEMO_CREDS = {
  admin:   { email: 'admin@university.edu',    password: 'Password@123' },
  faculty: { email: 'faculty1@university.edu', password: 'Password@123' },
  student: { email: 'cs21001@university.edu',  password: 'Password@123' },
};

export default function LoginPage() {
  const navigate    = useNavigate();
  const isLoggedIn  = useSelector(selectIsLoggedIn);
  const currentRole = useSelector(selectRole);
  const { login, isLoading, error, dismissError } = useAuth();

  const [role,     setRole]     = useState('admin');
  const [email,    setEmail]    = useState(DEMO_CREDS.admin.email);
  const [password, setPassword] = useState(DEMO_CREDS.admin.password);
  const [showPass, setShowPass] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (isLoggedIn) {
      const route = currentRole === 'admin' ? '/admin/dashboard'
        : currentRole === 'faculty' ? '/faculty/dashboard'
        : '/student/dashboard';
      navigate(route, { replace: true });
    }
  }, [isLoggedIn, currentRole, navigate]);

  // Pre-fill demo credentials on role change
  const handleRoleChange = (r) => {
    setRole(r);
    setEmail(DEMO_CREDS[r].email);
    setPassword(DEMO_CREDS[r].password);
    dismissError();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await login(email, password);
  };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#07090f', padding:24 }}>
      <div style={{ width:'100%', maxWidth:400 }}>

        {/* Logo */}
        <div className="animate-fade-up" style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ width:52, height:52, borderRadius:14, background:'rgba(61,127,255,.13)', border:'1px solid rgba(61,127,255,.4)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
            <Activity size={26} color="#3d7fff" />
          </div>
          <h1 className="font-space" style={{ fontSize:24, fontWeight:700, color:'#c8d6f0', marginBottom:4 }}>AttendanceAI</h1>
          <p style={{ fontSize:13, color:'#5a7098' }}>Automated Monitoring & Analytics for Colleges</p>
        </div>

        {/* Card */}
        <div className="card animate-fade-up" style={{ padding:22, animationDelay:'.1s' }}>

          {/* Role selector */}
          <p style={{ fontSize:11, fontWeight:600, color:'#5a7098', textTransform:'uppercase', letterSpacing:.5, marginBottom:12 }}>
            Sign in as
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:20 }}>
            {ROLES.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleRoleChange(r.id)}
                style={{
                  padding:'12px 8px', borderRadius:10,
                  border:`1px solid ${role === r.id ? r.color+'60' : '#1c2840'}`,
                  background:role === r.id ? r.bg : '#141e2e',
                  cursor:'pointer', textAlign:'center', transition:'all .18s',
                }}
              >
                <r.icon size={18} color={role === r.id ? r.color : '#5a7098'} style={{ margin:'0 auto 6px', display:'block' }} />
                <div style={{ fontSize:12, fontWeight:600, color:role === r.id ? r.color : '#5a7098' }}>{r.label}</div>
                <div style={{ fontSize:10, color:'#2d3f58', marginTop:2 }}>{r.desc}</div>
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:16 }}>
              <div>
                <label style={{ fontSize:12, color:'#5a7098', fontWeight:500, display:'block', marginBottom:5 }}>Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label style={{ fontSize:12, color:'#5a7098', fontWeight:500, display:'block', marginBottom:5 }}>Password</label>
                <div style={{ position:'relative' }}>
                  <input
                    className="input"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    style={{ paddingRight:40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#5a7098' }}
                  >
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{ padding:'8px 12px', background:'rgba(255,77,109,.13)', border:'1px solid rgba(255,77,109,.3)', borderRadius:8, fontSize:12, color:'#ff4d6d', marginBottom:12 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width:'100%', justifyContent:'center', padding:'11px 16px', fontSize:14 }}
              disabled={isLoading}
            >
              {isLoading ? (
                <span style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ width:14, height:14, border:'2px solid rgba(255,255,255,.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
                  Signing in…
                </span>
              ) : (
                <><Lock size={14} />Sign in to Dashboard</>
              )}
            </button>
          </form>

          <div style={{ marginTop:14, padding:'9px 12px', background:'#141e2e', borderRadius:8, fontSize:11, color:'#5a7098', textAlign:'center' }}>
            Demo credentials are pre-filled — pick a role and sign in
          </div>
        </div>
      </div>
    </div>
  );
}
