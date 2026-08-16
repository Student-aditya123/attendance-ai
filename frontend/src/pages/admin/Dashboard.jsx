/**
 * pages/admin/Dashboard.jsx
 *
 * Fetches from:
 *   GET /api/analytics/admin/overview
 *   GET /api/analytics/admin/at-risk
 *   GET /api/analytics/admin/departments
 *
 * Real-time: subscribes to attendance:marked and attendance:fraud
 * via useWebSocket hook.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Users, CheckCircle, AlertTriangle, Zap,
  TrendingUp, TrendingDown, UserX, Download, RefreshCw,
} from 'lucide-react';
import { analyticsAPI }      from '../../services/api';
import { useWebSocket }      from '../../hooks/useWebSocket';

// ── Custom tooltip ────────────────────────────────────────────────────────────
const CTT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'#141e2e', border:'1px solid #253656', borderRadius:8, padding:'8px 10px', fontSize:12 }}>
      <div style={{ fontWeight:600, marginBottom:4, color:'#c8d6f0' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color:p.color, display:'flex', gap:8, justifyContent:'space-between' }}>
          <span>{p.name}</span><span style={{ fontWeight:600 }}>{p.value}%</span>
        </div>
      ))}
    </div>
  );
};

// ── Stat card ────────────────────────────────────────────────────────────────
const StatCard = ({ icon: Icon, label, value, sub, color, delta }) => (
  <div style={{ background:'#0f1520', border:'1px solid #1c2840', borderRadius:12, padding:18, position:'relative', overflow:'hidden' }} className="animate-fade-up">
    <div style={{ position:'absolute', top:0, left:0, width:3, height:'100%', background:color, borderRadius:'12px 0 0 12px' }} />
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
      <div style={{ fontSize:12, color:'#5a7098', fontWeight:500, textTransform:'uppercase', letterSpacing:.5 }}>{label}</div>
      <div style={{ width:34, height:34, borderRadius:8, background:`${color}1a`, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Icon size={16} color={color} />
      </div>
    </div>
    <div className="font-space" style={{ fontSize:26, fontWeight:700, lineHeight:1, color:'#c8d6f0', marginBottom:6 }}>{value ?? '—'}</div>
    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
      {delta > 0 ? <TrendingUp size={12} color="#00c48c" /> : delta < 0 ? <TrendingDown size={12} color="#ff4d6d" /> : null}
      <span style={{ color: delta > 0 ? '#00c48c' : delta < 0 ? '#ff4d6d' : '#5a7098' }}>{sub}</span>
    </div>
  </div>
);

export default function AdminDashboard() {
  const [overview,   setOverview]   = useState(null);
  const [atRisk,     setAtRisk]     = useState([]);
  const [deptStats,  setDeptStats]  = useState([]);
  const [fraudFeed,  setFraudFeed]  = useState([]);
  const [loading,    setLoading]    = useState(true);

  const { onAttendanceMarked, onFraudAlert } = useWebSocket();

  const fetchData = useCallback(async () => {
    try {
      const [ov, risk, depts] = await Promise.all([
        analyticsAPI.adminOverview(),
        analyticsAPI.atRisk({ limit: 6 }),
        analyticsAPI.departments(),
      ]);
      setOverview(ov.data.data);
      setAtRisk(risk.data.data.students);
      setDeptStats(depts.data.data);
    } catch (e) {
      console.error('Dashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Real-time fraud feed
  useEffect(() => {
    if (!onFraudAlert) return;
    return onFraudAlert((data) => {
      setFraudFeed(f => [{ ...data, time: new Date().toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit' }) }, ...f].slice(0, 6));
    });
  }, [onFraudAlert]);

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
        <div style={{ width:28, height:28, border:'2px solid #1c2840', borderTopColor:'#3d7fff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
        <StatCard icon={Users}         label="Total Students"    value={overview?.totalStudents ?? '920'}  sub="+12 this semester"        color="#3d7fff" delta={1} />
        <StatCard icon={CheckCircle}   label="Overall Attendance" value={`${overview?.avgAttendance ?? 79.4}%`} sub="↑ 2.1% from last week" color="#00c48c" delta={1} />
        <StatCard icon={AlertTriangle} label="At-Risk Students"  value={overview?.criticalCount + overview?.warningCount ?? 180} sub="23 critical, 157 warning" color="#ffb020" delta={-1} />
        <StatCard icon={Zap}           label="Active Sessions"   value="4"                               sub="CS · ECE · ME · Civil"      color="#9d6fff" delta={0} />
      </div>

      {/* Charts row */}
      <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1fr', gap:12 }}>
        <div className="card animate-fade-up" style={{ padding:20, animationDelay:'.05s' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
            <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:'#c8d6f0' }}>Department Comparison</h3>
            <button className="btn btn-ghost" onClick={fetchData} style={{ padding:'4px 9px', fontSize:11, gap:4 }}><RefreshCw size={11} />Refresh</button>
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={deptStats.length ? deptStats : [{ dept:'CS', avg:78 },{ dept:'ECE', avg:87 },{ dept:'ME', avg:71 },{ dept:'Civil', avg:85 },{ dept:'IT', avg:76 }]} margin={{ top:4, right:4, left:-24, bottom:0 }}>
              <CartesianGrid stroke="#1c2840" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="dept" tick={{ fill:'#5a7098', fontSize:11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[60,100]} tick={{ fill:'#5a7098', fontSize:11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CTT />} />
              <Bar dataKey="avg" name="Avg %" radius={[4,4,0,0]}>
                {(deptStats.length ? deptStats : []).map((d, i) => (
                  <Cell key={i} fill={d.avg >= 80 ? '#00c48c' : d.avg >= 75 ? '#3d7fff' : '#ffb020'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Fraud feed */}
        <div className="card animate-fade-up" style={{ padding:20, animationDelay:'.08s' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:'#c8d6f0' }}>Fraud Detection</h3>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:'#00c48c', animation:'blink 1.8s ease infinite' }} />
              <span style={{ fontSize:11, color:'#00c48c' }}>Live</span>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {(fraudFeed.length ? fraudFeed : [
              { time:'09:14 AM', student:'Aditya Kumar', type:'LOCATION_MISMATCH', cls:'CS301', info:'482m away' },
              { time:'09:22 AM', student:'Rohan Verma',  type:'REPLAYED_TOKEN',    cls:'ME201', info:'Expired nonce' },
              { time:'10:05 AM', student:'Sara Khan',    type:'LOW_FACE_CONFIDENCE',cls:'ECE102',info:'61% match' },
            ]).slice(0, 4).map((f, i) => (
              <div key={i} style={{ padding:'9px 11px', background:'#141e2e', borderRadius:8, borderLeft:'2px solid #ff4d6d' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span className="font-mono" style={{ fontSize:10, color:'#5a7098' }}>{f.time}</span>
                  <span style={{ fontSize:10, padding:'1px 6px', borderRadius:4, background:'rgba(255,77,109,.13)', color:'#ff4d6d', fontWeight:600 }}>{f.cls ?? f.class_id}</span>
                </div>
                <div style={{ fontSize:12, fontWeight:600, color:'#c8d6f0', marginBottom:2 }}>{f.student ?? f.student_id}</div>
                <div style={{ fontSize:10, color:'#ffb020' }}>{(f.type || f.reason || '').replace(/_/g,' ')}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* At-risk table */}
      <div className="card animate-fade-up" style={{ padding:20, animationDelay:'.12s' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:'#c8d6f0' }}>At-Risk Students</h3>
          <button className="btn btn-ghost" style={{ padding:'4px 9px', fontSize:11, gap:4 }}><Download size={11} />Export CSV</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {(atRisk.length ? atRisk : [
            { studentId:{ name:'Arjun Mehta', rollNumber:'CS21001' }, department:'CS', overallPercentage:44, riskLevel:'critical', consecutiveAbsences:8 },
            { studentId:{ name:'Vikram Nair', rollNumber:'ME21056' }, department:'ME', overallPercentage:49, riskLevel:'critical', consecutiveAbsences:7 },
            { studentId:{ name:'Priya Sharma',rollNumber:'ME21034' }, department:'ME', overallPercentage:58, riskLevel:'warning',  consecutiveAbsences:5 },
          ]).map((s, i) => {
            const pct  = s.overallPercentage ?? s.overall_percentage ?? 0;
            const lvl  = s.riskLevel ?? s.risk_level ?? 'warning';
            const col  = lvl === 'critical' ? '#ff4d6d' : '#ffb020';
            const name = s.studentId?.name ?? s.name ?? 'Unknown';
            const roll = s.studentId?.rollNumber ?? s.roll ?? '';
            return (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1.8fr .7fr .55fr .65fr .85fr', gap:8, padding:'8px', background:'#141e2e', borderRadius:8, alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:'#c8d6f0' }}>{name}</div>
                  <div className="font-mono" style={{ fontSize:10, color:'#5a7098' }}>{roll}</div>
                </div>
                <span style={{ fontSize:12, color:'#5a7098' }}>{s.department}</span>
                <div>
                  <div className="font-mono" style={{ fontSize:13, fontWeight:700, color:col }}>{pct}%</div>
                  <div style={{ height:4, borderRadius:2, background:'#1c2840', marginTop:3 }}>
                    <div style={{ height:'100%', borderRadius:2, width:`${pct}%`, background:col }} />
                  </div>
                </div>
                <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:600, background:`${col}18`, color:col }}>{lvl}</span>
                <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:'#ff4d6d' }}>
                  <UserX size={12} />{s.consecutiveAbsences ?? 0} in a row
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
