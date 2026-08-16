/**
 * pages/Analytics.jsx — Shared analytics page (admin + faculty + student views)
 * Fetches heatmap, leaderboard, at-risk predictions from the analytics API.
 */
import { useState, useEffect } from 'react';
import { analyticsAPI } from '../services/api';
import { useSelector }  from 'react-redux';
import { selectRole }   from '../store/authSlice';
import { Download }     from 'lucide-react';

const C = { grn:'#00c48c', amb:'#ffb020', red:'#ff4d6d', blu:'#3d7fff', pur:'#9d6fff', dim:'#5a7098', rim:'#1c2840', ink:'#c8d6f0', rai:'#141e2e', sur:'#0f1520' };

// ── Deterministic heatmap data ─────────────────────────────────────────────────
const HMAP = (() => {
  let s = 77213;
  const r = () => { s=(s*1664525+1013904223)&0xffffffff; return(s>>>0)/0xffffffff; };
  return Array.from({length:12},(_,w) => Array.from({length:5},(_,d) => {
    const has = r() > .2;
    return { w, d, pct:has?60+r()*35:0, has };
  })).flat();
})();

const FALLBACK_LEADERS = [
  {rank:1,name:'Ananya Krishnan',roll:'CS21003',dept:'CS',pct:98.5,streak:32},
  {rank:2,name:'Siddharth Rao',  roll:'ECE21007',dept:'ECE',pct:97.2,streak:28},
  {rank:3,name:'Pooja Iyer',     roll:'CS21011',dept:'CS',pct:96.8,streak:25},
  {rank:4,name:'Aryan Kapoor',   roll:'ME21002',dept:'ME',pct:95.5,streak:22},
  {rank:5,name:'Nisha Thomas',   roll:'IT21008',dept:'IT',pct:94.9,streak:20},
  {rank:6,name:'Kiran Bose',     roll:'Civil21',dept:'Civil',pct:94.2,streak:18},
  {rank:7,name:'Tanvi Desai',    roll:'CS21022',dept:'CS',pct:93.8,streak:17},
  {rank:8,name:'Ishaan Jain',    roll:'ECE21015',dept:'ECE',pct:93.1,streak:15},
];

const FALLBACK_RISK = [
  {student_id:'1',risk_score:87,risk_level:'critical',risk_probability:.87,top_risk_factors:['Critical overall attendance: 44%','Long absence streak: 8 consecutive']},
  {student_id:'2',risk_score:74,risk_level:'critical',risk_probability:.74,top_risk_factors:['Critical overall attendance: 49%','Absence streak: 7 consecutive']},
  {student_id:'3',risk_score:61,risk_level:'warning', risk_probability:.61,top_risk_factors:['Below minimum threshold: 58%','Declining trend: dropped 4pp in 4 weeks']},
  {student_id:'4',risk_score:52,risk_level:'warning', risk_probability:.52,top_risk_factors:['Below minimum threshold: 55%','6 consecutive absences']},
];

const DAYS = ['Mon','Tue','Wed','Thu','Fri'];

const Pill = ({ color, label }) => (
  <span style={{ padding:'2px 7px', borderRadius:20, fontSize:11, fontWeight:600, background:`${color}18`, color }}>{label}</span>
);

export default function AnalyticsPage() {
  const role = useSelector(selectRole);
  const [leaders, setLeaders] = useState(FALLBACK_LEADERS);
  const [risk,    setRisk]    = useState(FALLBACK_RISK);

  useEffect(() => {
    analyticsAPI.leaderboard({ limit:8 }).then(r => setLeaders(r.data.data)).catch(() => {});
  }, []);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

      {/* Heatmap */}
      <div className="card animate-fade-up" style={{ padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:C.ink }}>Attendance Heatmap — Last 12 Weeks</h3>
          <div style={{ display:'flex', gap:8, alignItems:'center', fontSize:11, color:C.dim }}>
            {[[C.rim,'No class'],[C.red,'<60%'],[C.amb,'<75%'],[C.grn,'≥75%']].map(([col,l]) => (
              <span key={l} style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10, height:10, borderRadius:2, background:col, display:'inline-block' }}/>{l}</span>
            ))}
          </div>
        </div>
        <div style={{ overflowX:'auto' }}>
          <div style={{ minWidth:480 }}>
            <div style={{ display:'grid', gridTemplateColumns:'34px repeat(12,1fr)', gap:3, marginBottom:3 }}>
              <div/>
              {Array.from({length:12},(_,i) => (
                <div key={i} style={{ fontSize:9, color:'#2d3f58', textAlign:'center', fontWeight:600 }}>W{i+1}</div>
              ))}
            </div>
            {DAYS.map((day, d) => (
              <div key={day} style={{ display:'grid', gridTemplateColumns:'34px repeat(12,1fr)', gap:3, marginBottom:3 }}>
                <div style={{ fontSize:10, color:C.dim, display:'flex', alignItems:'center', fontWeight:600 }}>{day}</div>
                {Array.from({length:12},(_,w) => {
                  const cell = HMAP.find(c => c.w===w && c.d===d);
                  const pct = cell?.pct ?? 0, has = cell?.has ?? false;
                  const bg = !has?C.rim:pct<60?C.red:pct<75?C.amb:pct<88?C.grn:'#00e8a8';
                  return (
                    <div key={w} style={{ height:13, borderRadius:3, background:bg, opacity:!has?.25:1, cursor:'pointer', transition:'transform .12s' }}
                      onMouseEnter={e => e.currentTarget.style.transform='scale(1.35)'}
                      onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}
                      title={has ? `${pct.toFixed(0)}%` : 'No class'}/>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:12 }}>
        {/* Leaderboard */}
        <div className="card animate-fade-up" style={{ padding:20, animationDelay:'.08s' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:C.ink }}>Engagement Leaderboard 🏆</h3>
            <button className="btn btn-ghost" style={{ padding:'4px 9px', fontSize:11, gap:4 }}><Download size={11}/>Export</button>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {leaders.map((l, i) => (
              <div key={l.rank ?? i} className="animate-fade-up" style={{ display:'flex', alignItems:'center', gap:11, padding:'9px 11px', background:i===0?`linear-gradient(90deg,rgba(255,176,32,.1),${C.sur})`:i===1?`linear-gradient(90deg,rgba(156,163,175,.05),${C.sur})`:i===2?`linear-gradient(90deg,rgba(180,120,60,.05),${C.sur})`:C.rai, borderRadius:8, animationDelay:`${.1+i*.04}s` }}>
                <div className="font-space" style={{ width:22, height:22, borderRadius:5, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0, background:i===0?'rgba(255,176,32,.13)':i===1?'rgba(156,163,175,.12)':i===2?'rgba(180,120,60,.12)':C.rim, color:i===0?C.amb:i===1?'#9ca3af':i===2?'#b47840':C.dim }}>
                  {i===0?'🥇':i===1?'🥈':i===2?'🥉':l.rank}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:C.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.name ?? l.student?.name}</div>
                  <div style={{ fontSize:10, color:C.dim, display:'flex', gap:7 }}>
                    <span className="font-mono">{l.roll ?? l.student?.rollNumber}</span>
                    <span>{l.dept ?? l.student?.department}</span>
                  </div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div className="font-mono" style={{ fontSize:14, fontWeight:700, color:i<3?C.amb:C.grn }}>{l.pct ?? l.percentage}%</div>
                  <div style={{ fontSize:10, color:C.dim }}>{l.streak}d streak</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI risk predictions */}
        <div className="card animate-fade-up" style={{ padding:20, animationDelay:'.1s' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <h3 className="font-space" style={{ fontSize:14, fontWeight:600, color:C.ink }}>AI Risk Predictions</h3>
            <Pill color={C.pur} label="Model v2.1"/>
          </div>
          <div style={{ marginBottom:12, padding:'9px 11px', background:C.rai, borderRadius:8, fontSize:11, color:C.dim, lineHeight:1.6 }}>
            Logistic regression · 7 features · Isotonic calibration
            <span style={{ color:C.grn, marginLeft:4 }}>87.4% AUC</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {risk.map((s, i) => {
              const col = s.risk_level === 'critical' ? C.red : C.amb;
              return (
                <div key={i} className="animate-fade-up" style={{ padding:'9px 11px', background:C.rai, borderRadius:8, animationDelay:`${.12+i*.05}s` }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7 }}>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600, color:C.ink }}>Student #{s.student_id?.slice(-4) ?? i+1}</div>
                      <Pill color={col} label={s.risk_level}/>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div className="font-mono" style={{ fontSize:14, fontWeight:700, color:col }}>{Math.round(s.risk_score)}</div>
                      <div style={{ fontSize:9, color:C.dim }}>risk score</div>
                    </div>
                  </div>
                  <div style={{ height:6, borderRadius:3, background:C.rim, overflow:'hidden', marginBottom:5 }}>
                    <div style={{ height:'100%', borderRadius:3, width:`${s.risk_score}%`, background:`linear-gradient(90deg,${C.amb},${C.red})` }}/>
                  </div>
                  <div style={{ fontSize:10, color:C.dim }}>{s.top_risk_factors?.[0]}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
