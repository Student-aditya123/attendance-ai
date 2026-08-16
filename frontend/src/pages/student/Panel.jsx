/**
 * pages/student/Panel.jsx — Personal attendance dashboard
 * Fetches: GET /api/attendance/students/:id/summary
 * Real-time: onNotification for low-attendance alerts
 */
import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, TrendingDown, TrendingUp, Filter } from 'lucide-react';
import { attendanceAPI } from '../../services/api';
import { useWebSocket }  from '../../hooks/useWebSocket';
import { useSelector }   from 'react-redux';
import { selectUser }    from '../../store/authSlice';

const C = { grn:'#00c48c', amb:'#ffb020', red:'#ff4d6d', blu:'#3d7fff', dim:'#5a7098', rim:'#1c2840', ink:'#c8d6f0' };

const Pill = ({ color, label }) => (
  <span style={{ padding:'2px 7px', borderRadius:20, fontSize:11, fontWeight:600, background:`${color}18`, color }}>{label}</span>
);

const CTT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'#141e2e', border:`1px solid #253656`, borderRadius:8, padding:'8px 10px', fontSize:12, color:'#c8d6f0' }}>
      <div style={{ fontWeight:600, marginBottom:4 }}>{label}</div>
      {payload.map((p,i) => <div key={i} style={{ color:p.color }}>{p.name}: <b>{p.value}%</b></div>)}
    </div>
  );
};

export default function StudentPanel() {
  const user = useSelector(selectUser);
  const [summary,  setSummary]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [alerts,   setAlerts]   = useState([]);
  const { onNotification } = useWebSocket();

  const fetchSummary = useCallback(async () => {
    if (!user?._id) return;
    try {
      const { data } = await attendanceAPI.getStudentSummary(user._id);
      setSummary(data.data);
    } catch { /* use fallback data */ } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  useEffect(() => {
    if (!onNotification) return;
    return onNotification(n => {
      if (n.type === 'LOW_ATTENDANCE') setAlerts(a => [n, ...a].slice(0, 3));
    });
  }, [onNotification]);

  // Fallback data for demo
  const overall = summary?.overall ?? 73.6;
  const subjects = summary?.subjects ?? [
    { subjectCode:'CS301', subjectName:'Data Structures',   totalClasses:24, attended:18, percentage:75 },
    { subjectCode:'CS302', subjectName:'Algorithms',        totalClasses:22, attended:20, percentage:91 },
    { subjectCode:'CS303', subjectName:'DBMS',              totalClasses:26, attended:16, percentage:62 },
    { subjectCode:'CS304', subjectName:'Operating Systems', totalClasses:20, attended:15, percentage:75 },
    { subjectCode:'CS305', subjectName:'Networks',          totalClasses:18, attended:10, percentage:56 },
  ];
  const trend = [
    {w:'Wk1',p:88},{w:'Wk2',p:82},{w:'Wk3',p:75},{w:'Wk4',p:70},
    {w:'Wk5',p:68},{w:'Wk6',p:72},{w:'Wk7',p:69},{w:'Wk8',p:74},
  ];
  const isAtRisk = overall < 75;
  const gaugeColor = overall >= 85 ? C.grn : overall >= 75 ? C.blu : C.amb;

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <div style={{ width:28, height:28, border:'2px solid #1c2840', borderTopColor:'#3d7fff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

      {/* Alerts */}
      {(isAtRisk || alerts.length > 0) && (
        <div className="animate-fade-up" style={{ padding:'11px 15px', borderRadius:10, background:'rgba(255,176,32,.13)', border:'1px solid rgba(255,176,32,.3)', display:'flex', alignItems:'center', gap:12 }}>
          <AlertTriangle size={17} color={C.amb} />
          <div>
            <span style={{ fontWeight:600, color:C.amb }}>Attendance Warning</span>
            <span style={{ color:C.dim, fontSize:13, marginLeft:8 }}>
              Your overall attendance is {overall}%, below the 75% requirement.
              Attend {Math.max(0, Math.ceil((0.75 * 133 - 98) / 0.25))} more classes to reach the threshold.
            </span>
          </div>
        </div>
      )}

      {/* Top row */}
      <div style={{ display:'grid', gridTemplateColumns:'270px 1fr', gap:12 }}>
        {/* Gauge */}
        <div className="card animate-fade-up" style={{ padding:18, display:'flex', flexDirection:'column', alignItems:'center', gap:8, animationDelay:'.05s' }}>
          <p style={{ fontSize:11, color:C.dim, fontWeight:500, textTransform:'uppercase', letterSpacing:.5 }}>Overall Attendance</p>
          <div style={{ position:'relative', display:'flex', alignItems:'center', justifyContent:'center', margin:'8px 0' }}>
            <svg width={155} height={95} viewBox="0 0 155 95">
              <path d="M 8 86 A 68 68 0 0 1 147 86" fill="none" stroke={C.rim} strokeWidth={12} strokeLinecap="round"/>
              <path d="M 8 86 A 68 68 0 0 1 147 86" fill="none" stroke={gaugeColor} strokeWidth={12} strokeLinecap="round"
                strokeDasharray={`${(overall/100)*214} 214`} style={{ transition:'stroke-dasharray .8s ease' }}/>
            </svg>
            <div style={{ position:'absolute', bottom:2, textAlign:'center' }}>
              <div className="font-space" style={{ fontSize:28, fontWeight:700, color:gaugeColor, lineHeight:1 }}>{overall}%</div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, width:'100%', marginTop:4 }}>
            {[['Classes Attended','98 / 133',C.blu],['Need to be Safe',`${Math.max(0,6)} more`,C.amb]].map(([l,v,c]) => (
              <div key={l} style={{ textAlign:'center', padding:'8px', background:'#141e2e', borderRadius:8 }}>
                <div style={{ fontSize:11, color:C.dim, marginBottom:3 }}>{l}</div>
                <div className="font-mono" style={{ fontSize:14, fontWeight:700, color:c }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Weekly trend */}
        <div className="card animate-fade-up" style={{ padding:20, animationDelay:'.08s' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:C.ink }}>Weekly Trend</h3>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:C.red }}>
              <TrendingDown size={13} color={C.red} /> Dropped 14% over 8 weeks
            </div>
          </div>
          <ResponsiveContainer width="100%" height={155}>
            <LineChart data={trend} margin={{ top:4, right:4, left:-24, bottom:0 }}>
              <defs>
                <linearGradient id="trendG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.blu} stopOpacity={.3}/>
                  <stop offset="100%" stopColor={C.blu} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.rim} strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="w" tick={{ fill:C.dim, fontSize:11 }} axisLine={false} tickLine={false}/>
              <YAxis domain={[55,100]} tick={{ fill:C.dim, fontSize:11 }} axisLine={false} tickLine={false}/>
              <Tooltip content={<CTT/>}/>
              <Line type="monotone" dataKey="p" name="Attendance %" stroke={C.blu} strokeWidth={2.5} dot={{ fill:C.blu, strokeWidth:0, r:3 }}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Subject breakdown */}
      <div className="card animate-fade-up" style={{ padding:20, animationDelay:'.12s' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:C.ink }}>Subject-wise Breakdown</h3>
          <button className="btn btn-ghost" style={{ padding:'4px 9px', fontSize:11, gap:4 }}><Filter size={11}/>Sort</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {subjects.map((s, i) => {
            const pct = s.percentage ?? s.pct ?? 0;
            const col = pct < 60 ? C.red : pct < 75 ? C.amb : pct < 88 ? C.blu : C.grn;
            const needed = pct < 75 ? Math.ceil((0.75 * s.totalClasses - s.attended) / (1 - 0.75)) : 0;
            return (
              <div key={s.subjectCode} className="animate-fade-up" style={{ display:'grid', gridTemplateColumns:'115px 1fr 60px 90px', gap:12, alignItems:'center', animationDelay:`${.14 + i*.05}s` }}>
                <div>
                  <div className="font-mono" style={{ fontSize:10, color:C.blu, fontWeight:600 }}>{s.subjectCode}</div>
                  <div style={{ fontSize:12, color:C.ink, marginTop:2 }}>{s.subjectName}</div>
                </div>
                <div>
                  <div style={{ height:8, borderRadius:4, background:C.rim, overflow:'hidden' }}>
                    <div style={{ height:'100%', borderRadius:4, width:`${pct}%`, background:col, transition:'width .6s ease' }}/>
                  </div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div className="font-mono" style={{ fontSize:13, fontWeight:700, color:col }}>{pct}%</div>
                  <div style={{ fontSize:10, color:C.dim }}>{s.attended}/{s.totalClasses}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  {pct < 75 ? <Pill color={C.red} label={`Need ${needed} more`}/> : <Pill color={C.grn} label="Safe ✓"/>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
