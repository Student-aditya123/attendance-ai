/**
 * components/layout/DashboardLayout.jsx
 *
 * Wraps every authenticated page with:
 *   - Collapsible sidebar (role-aware navigation)
 *   - Top bar (search, notifications, user menu)
 *   - Scrollable content area
 *   - Real-time notification badge from WebSocket
 *
 * The sidebar collapses to icon-only mode (52px) on small screens.
 * Content area key changes on route change to trigger fade-in animation.
 */
import { useState, useEffect }  from 'react';
import { useLocation, Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useSelector }           from 'react-redux';
import {
  Activity, Home, BarChart2, QrCode, Users, Shield,
  Bell, LogOut, Menu, ChevronDown, Search,
} from 'lucide-react';
import { useAuth }               from '../../hooks/useAuth';
import { useWebSocket }          from '../../hooks/useWebSocket';
import { selectUser, selectRole } from '../../store/authSlice';

const NAV = {
  admin: [
    { to: '/admin/dashboard',  icon: Home,     label: 'Dashboard'  },
    { to: '/admin/analytics',  icon: BarChart2, label: 'Analytics'  },
    { to: '/admin/students',   icon: Users,     label: 'Students'   },
    { to: '/admin/security',   icon: Shield,    label: 'Security'   },
  ],
  faculty: [
    { to: '/faculty/dashboard', icon: Home,     label: 'My Classes' },
    { to: '/faculty/session',   icon: QrCode,   label: 'Session'    },
    { to: '/faculty/analytics', icon: BarChart2, label: 'Reports'   },
  ],
  student: [
    { to: '/student/dashboard', icon: Home,     label: 'Attendance' },
    { to: '/student/scanner',   icon: QrCode,   label: 'Scan'       },
    { to: '/student/analytics', icon: BarChart2, label: 'Analytics' },
  ],
};

const ROLE_COLORS = { admin: '#9d6fff', faculty: '#3d7fff', student: '#00c48c' };

export default function DashboardLayout() {
  const location   = useLocation();
  const user       = useSelector(selectUser);
  const role       = useSelector(selectRole);
  const { logout } = useAuth();
  const { connected, onNotification } = useWebSocket();

  const [collapsed,     setCollapsed]     = useState(false);
  const [notifications, setNotifications] = useState([]);

  // Listen for personal notifications
  useEffect(() => {
    if (!onNotification) return;
    return onNotification((data) => {
      setNotifications(n => [data, ...n].slice(0, 20));
    });
  }, [onNotification]);

  const items    = NAV[role] || [];
  const roleColor = ROLE_COLORS[role] || '#3d7fff';
  const unread   = notifications.filter(n => !n.read).length;

  const sidebarWidth = collapsed ? 52 : 195;

  return (
    <div style={{ display:'flex', height:'100vh', background:'#07090f', overflow:'hidden', fontFamily:"'Inter',system-ui,sans-serif", color:'#c8d6f0' }}>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside style={{ width:sidebarWidth, flexShrink:0, height:'100%', background:'linear-gradient(180deg,#050c18 0%,#07090f 100%)', borderRight:'1px solid #1c2840', display:'flex', flexDirection:'column', transition:'width .25s ease', overflow:'hidden' }}>

        {/* Logo */}
        <div style={{ padding:collapsed ? '13px 0' : '13px 15px', display:'flex', alignItems:'center', justifyContent:collapsed ? 'center' : 'flex-start', gap:10, borderBottom:'1px solid #1c2840', marginBottom:11 }}>
          <div style={{ width:27, height:27, borderRadius:7, background:'rgba(61,127,255,.13)', border:'1px solid rgba(61,127,255,.4)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <Activity size={14} color="#3d7fff" />
          </div>
          {!collapsed && <span className="font-space" style={{ fontSize:13, fontWeight:700, color:'#c8d6f0', whiteSpace:'nowrap' }}>AttendAI</span>}
        </div>

        {/* Role badge */}
        {!collapsed && (
          <div style={{ padding:'0 11px', marginBottom:11 }}>
            <div style={{ padding:'5px 9px', borderRadius:7, background:'#141e2e', border:'1px solid #1c2840' }}>
              <div style={{ fontSize:10, color:'#2d3f58', textTransform:'uppercase', letterSpacing:.5, marginBottom:2 }}>Signed in as</div>
              <div style={{ fontSize:12, fontWeight:600, color:roleColor, textTransform:'capitalize' }}>{role}</div>
            </div>
          </div>
        )}

        {/* Nav items */}
        <nav style={{ padding:'0 7px', flex:1, display:'flex', flexDirection:'column', gap:3 }}>
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display:'flex', alignItems:'center', gap:10, padding:collapsed ? '9px' : '8px 11px',
                borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500,
                justifyContent: collapsed ? 'center' : 'flex-start',
                color:      isActive ? '#3d7fff' : '#5a7098',
                background: isActive ? 'rgba(61,127,255,.13)' : 'transparent',
                border:     `1px solid ${isActive ? 'rgba(61,127,255,.2)' : 'transparent'}`,
                transition:'all .18s', textDecoration:'none',
              })}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={15} style={{ flexShrink:0 }} />
              {!collapsed && <span style={{ whiteSpace:'nowrap' }}>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom actions */}
        <div style={{ padding:'7px', borderTop:'1px solid #1c2840' }}>
          <button onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}
            style={{ display:'flex', alignItems:'center', gap:10, padding:collapsed ? '9px' : '8px 11px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:500, width:'100%', background:'none', border:'none', color:'#5a7098', justifyContent:collapsed ? 'center' : 'flex-start' }}>
            <Menu size={14} style={{ flexShrink:0 }} />
            {!collapsed && <span style={{ whiteSpace:'nowrap' }}>Collapse</span>}
          </button>
          <button onClick={logout} title={collapsed ? 'Logout' : undefined}
            style={{ display:'flex', alignItems:'center', gap:10, padding:collapsed ? '9px' : '8px 11px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:500, width:'100%', background:'none', border:'none', color:'rgba(255,77,109,.8)', justifyContent:collapsed ? 'center' : 'flex-start' }}>
            <LogOut size={14} style={{ flexShrink:0 }} />
            {!collapsed && <span style={{ whiteSpace:'nowrap' }}>Logout</span>}
          </button>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────────────────── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>

        {/* Top bar */}
        <header style={{ height:50, borderBottom:'1px solid #1c2840', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 18px', flexShrink:0, background:'#0f1520' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:6, height:6, borderRadius:'50%', background:connected ? '#00c48c' : '#5a7098', marginRight:4 }} title={connected ? 'Live' : 'Offline'} />
            <span className="font-space" style={{ fontSize:14, fontWeight:600, color:'#c8d6f0' }}>
              {items.find(i => location.pathname.startsWith(i.to))?.label ?? 'Dashboard'}
            </span>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:11 }}>
            {/* Search */}
            <div style={{ position:'relative' }}>
              <input type="text" placeholder="Search…" className="input" style={{ width:150, padding:'5px 11px 5px 30px', fontSize:12, height:30 }} />
              <Search size={11} color="#5a7098" style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)' }} />
            </div>

            {/* Notification bell */}
            <div style={{ position:'relative', cursor:'pointer' }}>
              <Bell size={15} color="#5a7098" />
              {unread > 0 && (
                <div style={{ position:'absolute', top:-3, right:-3, width:15, height:15, borderRadius:'50%', background:'#ff4d6d', border:'1px solid #0f1520', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#fff' }}>
                  {unread > 9 ? '9+' : unread}
                </div>
              )}
            </div>

            {/* User chip */}
            <div style={{ display:'flex', alignItems:'center', gap:7, padding:'4px 9px', background:'#141e2e', borderRadius:8, border:'1px solid #1c2840' }}>
              <div style={{ width:22, height:22, borderRadius:5, background:`${roleColor}20`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <span style={{ fontSize:10, fontWeight:700, color:roleColor }}>{user?.name?.[0] ?? '?'}</span>
              </div>
              <span style={{ fontSize:12, color:'#c8d6f0', fontWeight:500, maxWidth:110, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.name ?? 'User'}</span>
              <ChevronDown size={11} color="#5a7098" />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main key={location.pathname} className="animate-fade-in" style={{ flex:1, overflowY:'auto', padding:14 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
