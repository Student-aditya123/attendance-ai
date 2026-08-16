/**
 * pages/faculty/Panel.jsx — My Classes overview
 * pages/faculty/MarkAttendance.jsx — Active session with rotating QR
 * Both exported from this file for simplicity.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { analyticsAPI, attendanceAPI } from '../../services/api';
import { useWebSocket }  from '../../hooks/useWebSocket';
import { useSelector }   from 'react-redux';
import { selectUser }    from '../../store/authSlice';
import { Zap, X, RefreshCw, Download, BookOpen, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const C = { grn:'#00c48c', amb:'#ffb020', red:'#ff4d6d', blu:'#3d7fff', pur:'#9d6fff', dim:'#5a7098', rim:'#1c2840', ink:'#c8d6f0', rai:'#141e2e', sur:'#0f1520' };

// ── Fake QR SVG ────────────────────────────────────────────────────────────────
function QRPattern({ seed = 1, size = 168 }) {
  const n = 21, cs = size / n;
  let s = seed * 31337 + 1;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const tl = r < 7 && c < 7, tr = r < 7 && c >= n-7, bl = r >= n-7 && c < 7;
    const inF = tl||tr||bl, inT = (r===6&&c>=8&&c<=n-9)||(c===6&&r>=8&&r<=n-9);
    let f;
    if (inF) { const lr = tl?r:(bl?r-(n-7):r), lc = tl?c:(tr?c-(n-7):c); f=(lr===0||lr===6||lc===0||lc===6)||(lr>=2&&lr<=4&&lc>=2&&lc<=4); }
    else if (inT) { f=(r+c)%2===0; } else { f=rand()>.5; }
    if (f) cells.push([r,c]);
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius:6 }}>
      <rect width={size} height={size} fill="#fff"/>
      {cells.map(([r,c],i) => <rect key={i} x={c*cs+.3} y={r*cs+.3} width={cs-.6} height={cs-.6} fill="#0a0a1a"/>)}
    </svg>
  );
}

// ── Countdown ring ─────────────────────────────────────────────────────────────
function Ring({ sec, total = 45 }) {
  const pct = sec / total, col = pct > .5 ? C.grn : pct > .25 ? C.amb : C.red;
  const r = 52, circ = 2 * Math.PI * r, dash = circ * pct;
  return (
    <svg width={120} height={120} viewBox="0 0 120 120">
      <circle cx={60} cy={60} r={r} fill="none" stroke={C.rim} strokeWidth={6}/>
      <circle cx={60} cy={60} r={r} fill="none" stroke={col} strokeWidth={6}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 60 60)"
        style={{ transition:'stroke-dasharray .9s linear,stroke .5s' }}/>
      <text x={60} y={55} textAnchor="middle" fill={col} fontSize={24} fontWeight={700} fontFamily="'JetBrains Mono',monospace">{sec}</text>
      <text x={60} y={71} textAnchor="middle" fill={C.dim} fontSize={10}>seconds</text>
    </svg>
  );
}

const CTT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return <div style={{ background:C.rai, border:`1px solid #253656`, borderRadius:8, padding:'8px 10px', fontSize:12, color:C.ink }}><div style={{ fontWeight:600, marginBottom:4 }}>{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.color}}>{p.name}: <b>{p.value}%</b></div>)}</div>;
};

// ════════════════════════════════════════════════════════════════════════════════
// FACULTY PANEL — My Classes
// ════════════════════════════════════════════════════════════════════════════════
export default function FacultyPanel() {
  const user = useSelector(selectUser);
  const [classes,  setClasses]  = useState([]);
  const [selId,    setSelId]    = useState(null);
  const [active,   setActive]   = useState(false);
  const [timer,    setTimer]    = useState(45);
  const [seed,     setSeed]     = useState(9001);
  const [sessionId,setSessionId]= useState(null);
  const [live,     setLive]     = useState([]);
  const { joinSession, leaveSession, onAttendanceMarked, onQrRotated } = useWebSocket();

  const FALLBACK = [
    { _id:'c1', subjectCode:'CS301', subjectName:'Data Structures',    enrolled:62, sessions:24, avg:78 },
    { _id:'c2', subjectCode:'CS401', subjectName:'Machine Learning',   enrolled:48, sessions:20, avg:84 },
    { _id:'c3', subjectCode:'CS202', subjectName:'Operating Systems',  enrolled:70, sessions:26, avg:71 },
  ];

  useEffect(() => {
    analyticsAPI.facultyClasses().then(r => {
      const data = r.data.data;
      if (data?.length) { setClasses(data); setSelId(data[0].classId ?? data[0]._id); }
      else { setClasses(FALLBACK); setSelId('c1'); }
    }).catch(() => { setClasses(FALLBACK); setSelId('c1'); });
  }, []);

  // QR countdown
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setTimer(t => { if (t <= 1) { setSeed(s => s+1); return 45; } return t-1; }), 1000);
    return () => clearInterval(iv);
  }, [active]);

  // Listen for live attendance marks
  useEffect(() => {
    if (!active || !onAttendanceMarked) return;
    return onAttendanceMarked(data => {
      const now = new Date();
      setLive(l => [{
        name: data.studentName ?? 'Student',
        roll: data.studentId?.slice(-6) ?? '———',
        time: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
        method: data.method ?? 'qr',
        conf: data.confidence ? Math.round(data.confidence * 100) : null,
      }, ...l]);
    });
  }, [active, onAttendanceMarked]);

  // QR rotation event
  useEffect(() => {
    if (!active || !onQrRotated) return;
    return onQrRotated(() => setSeed(s => s + 1));
  }, [active, onQrRotated]);

  const startSession = async () => {
    try {
      const cls = classes.find(c => (c._id ?? c.classId) === selId);
      const { data } = await attendanceAPI.createSession({
        classId: selId, latitude: 28.7041, longitude: 77.1025, radiusMeters: 100,
      });
      setSessionId(data.data.sessionId);
      setActive(true);
      setLive([]);
      setTimer(45);
      joinSession(data.data.sessionId);
    } catch {
      // Demo mode — just activate without real session
      setActive(true); setLive([]); setTimer(45);
    }
  };

  const endSession = async () => {
    try { if (sessionId) { await attendanceAPI.endSession(sessionId); leaveSession(sessionId); } }
    catch {}
    setActive(false); setLive([]); setTimer(45); setSessionId(null);
  };

  const cls = classes.find(c => (c._id ?? c.classId) === selId) ?? FALLBACK[0];
  const enrolled = cls?.enrolled ?? cls?.totalEnrolled ?? 62;
  const chartData = classes.map(c => ({ name: c.subjectCode, avg: c.avg ?? c.avgAttendance ?? 75 }));

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Class cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
        {classes.map((fc, i) => {
          const id = fc._id ?? fc.classId ?? i;
          const avg = fc.avg ?? fc.avgAttendance ?? 75;
          return (
            <div key={id} className="card animate-fade-up" style={{ padding:15, cursor:'pointer', animationDelay:`${i*.06}s`, borderColor:selId===id?`${C.blu}60`:C.rim, background:selId===id?'rgba(61,127,255,.13)':C.sur }}
              onClick={() => { setSelId(id); setActive(false); setLive([]); }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span className="font-mono" style={{ fontSize:11, color:C.blu, fontWeight:600 }}>{fc.subjectCode}</span>
                <span style={{ fontSize:10, color:C.dim }}>{fc.sessions ?? 24} sessions</span>
              </div>
              <div className="font-space" style={{ fontSize:14, fontWeight:600, color:C.ink, marginBottom:9 }}>{fc.subjectName ?? fc.name}</div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:12, color:C.dim, display:'flex', alignItems:'center', gap:4 }}><Users size={11}/>{fc.enrolled ?? fc.totalEnrolled ?? 0}</span>
                <span style={{ fontSize:13, fontWeight:700, color:avg>=75?C.grn:C.amb }}>{avg}%</span>
              </div>
              <div style={{ height:6, borderRadius:3, background:C.rim, overflow:'hidden', marginTop:7 }}>
                <div style={{ height:'100%', borderRadius:3, width:`${avg}%`, background:avg>=75?C.grn:C.amb, transition:'width .6s' }}/>
              </div>
            </div>
          );
        })}
      </div>

      {/* Session + roster */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1.4fr', gap:12 }}>
        {/* QR panel */}
        <div className="card animate-fade-up" style={{ padding:18, animationDelay:'.1s' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <div>
              <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:C.ink }}>{active ? 'Session Active' : 'Start Session'}</h3>
              <p style={{ fontSize:11, color:C.dim, marginTop:2 }}>{cls?.subjectCode} — {cls?.subjectName}</p>
            </div>
            {active && <div style={{ display:'flex', alignItems:'center', gap:6 }}><div style={{ width:7, height:7, borderRadius:'50%', background:C.grn, animation:'blink 1.8s ease infinite' }}/><span style={{ fontSize:11, color:C.grn }}>Live</span></div>}
          </div>

          {active ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14 }}>
              <Ring sec={timer} total={45} />
              <div style={{ position:'relative', border:`2px solid ${C.blu}`, borderRadius:12, overflow:'hidden' }}>
                <QRPattern seed={seed} size={168} />
                <div style={{ position:'absolute', left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${C.blu},transparent)`, animation:'scanLine 2.2s linear infinite', top:0, opacity:.7 }}/>
              </div>
              <div style={{ width:'100%', padding:'7px 11px', background:C.rai, borderRadius:8, fontSize:11, color:C.dim, textAlign:'center' }}>QR rotates every 45s · GPS radius: 100m</div>
              <div style={{ display:'flex', gap:8, width:'100%' }}>
                <button className="btn btn-ghost" style={{ flex:1, justifyContent:'center', fontSize:12 }} onClick={() => { setSeed(s => s+1); setTimer(45); }}><RefreshCw size={12}/>Rotate</button>
                <button className="btn btn-danger" style={{ flex:1, justifyContent:'center', fontSize:12 }} onClick={endSession}><X size={12}/>End Session</button>
              </div>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:18, padding:'18px 0' }}>
              <div style={{ width:110, height:110, borderRadius:14, border:`2px dashed ${C.rim}`, display:'flex', alignItems:'center', justifyContent:'center', opacity:.4 }}>
                <BookOpen size={44} color={C.dim} />
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:13, color:C.dim, marginBottom:3 }}>No active session</div>
                <div style={{ fontSize:11, color:'#2d3f58' }}>Start to generate rotating QR</div>
              </div>
              <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', padding:'11px' }} onClick={startSession}><Zap size={14}/>Start Attendance Session</button>
            </div>
          )}
        </div>

        {/* Roster */}
        <div className="card animate-fade-up" style={{ padding:18, animationDelay:'.15s' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:C.ink }}>Live Roster</h3>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span className="font-mono" style={{ fontSize:12, fontWeight:600, color:C.blu }}>{live.length}/{enrolled}</span>
              <button className="btn btn-ghost" style={{ padding:'4px 9px', fontSize:11, gap:4 }}><Download size={11}/>CSV</button>
            </div>
          </div>
          <div style={{ height:8, borderRadius:4, background:C.rim, overflow:'hidden', marginBottom:6 }}>
            <div style={{ height:'100%', borderRadius:4, width:`${(live.length/enrolled)*100}%`, background:`linear-gradient(90deg,${C.blu},${C.grn})`, transition:'width .6s' }}/>
          </div>
          <div style={{ fontSize:10, color:C.dim, textAlign:'right', marginBottom:10 }}>{((live.length/enrolled)*100).toFixed(0)}% present</div>

          <div style={{ display:'grid', gridTemplateColumns:'1.6fr .9fr .55fr .55fr', gap:4, padding:'3px 8px', fontSize:10, color:'#2d3f58', fontWeight:600, textTransform:'uppercase', letterSpacing:.4, marginBottom:5 }}>
            {['Student','Time','Mode','Match'].map(h => <span key={h}>{h}</span>)}
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:290, overflowY:'auto' }}>
            {(live.length ? live : [
              { name:'Aarav Shah',   roll:'CS21001', time:'09:03', method:'qr',   conf:null },
              { name:'Diya Gupta',   roll:'CS21004', time:'09:04', method:'qr',   conf:null },
              { name:'Kabir Mehta',  roll:'CS21009', time:'09:05', method:'face', conf:94   },
              { name:'Meera Pillai', roll:'CS21013', time:'09:06', method:'qr',   conf:null },
              { name:'Rohan Joshi',  roll:'CS21017', time:'09:08', method:'qr',   conf:null },
            ]).map((s, i) => (
              <div key={i} className="animate-slide-in" style={{ display:'grid', gridTemplateColumns:'1.6fr .9fr .55fr .55fr', gap:4, padding:'7px 8px', background:C.rai, borderRadius:8, alignItems:'center', animationDelay:`${Math.min(i*.025,.25)}s` }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:C.ink }}>{s.name}</div>
                  <div className="font-mono" style={{ fontSize:10, color:C.dim }}>{s.roll}</div>
                </div>
                <span className="font-mono" style={{ fontSize:11, color:C.dim }}>{s.time}</span>
                <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 6px', borderRadius:20, fontSize:10, fontWeight:600, background:s.method==='qr'?'rgba(61,127,255,.13)':'rgba(157,111,255,.13)', color:s.method==='qr'?C.blu:C.pur }}>{s.method?.toUpperCase()}</span>
                <span style={{ fontSize:11, color:s.conf ? C.grn : C.dim }}>{s.conf ? `${s.conf}%` : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Class performance chart */}
      <div className="card animate-fade-up" style={{ padding:20, animationDelay:'.2s' }}>
        <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:C.ink, marginBottom:14 }}>Class Attendance Comparison</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} margin={{ top:4, right:4, left:-24, bottom:0 }}>
            <CartesianGrid stroke={C.rim} strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="name" tick={{ fill:C.dim, fontSize:11 }} axisLine={false} tickLine={false}/>
            <YAxis domain={[60,100]} tick={{ fill:C.dim, fontSize:11 }} axisLine={false} tickLine={false}/>
            <Tooltip content={<CTT/>}/>
            <Bar dataKey="avg" name="Avg %" radius={[4,4,0,0]}>
              {chartData.map((d,i) => <Cell key={i} fill={d.avg>=80?C.grn:d.avg>=75?C.blu:C.amb}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Export a re-usable MarkAttendance page (alias for now — faculty goes here from session nav)
export { FacultyPanel as MarkAttendance };
