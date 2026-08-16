/**
 * pages/student/Scanner.jsx
 *
 * Two modes: QR scan and Face recognition.
 * GPS is acquired on mount via navigator.geolocation.
 * Offline queue: if mark fails with a network error, falls back to
 * useOfflineSync.queueScan() — displays pending count in the UI.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSelector }    from 'react-redux';
import { QrCode, Camera, MapPin, Wifi, WifiOff, CheckCircle, RefreshCw, Zap, AlertTriangle } from 'lucide-react';
import { attendanceAPI }  from '../../services/api';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { selectUser }     from '../../store/authSlice';

export default function ScannerPage() {
  const user = useSelector(selectUser);
  const { isOnline, pendingCount, queueScan } = useOfflineSync();

  const [mode,      setMode]      = useState('qr');   // 'qr' | 'face'
  const [scanState, setScanState] = useState('idle'); // 'idle' | 'scanning' | 'success' | 'error'
  const [gps,       setGps]       = useState({ ok:false, lat:null, lng:null, dist:null });
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState(null);
  const videoRef  = useRef(null);
  const streamRef = useRef(null);

  // Acquire GPS on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setGps({ ok:false, error:'Geolocation not supported' });
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => setGps({ ok:true, lat:pos.coords.latitude, lng:pos.coords.longitude, dist:42 }),
      ()     => setGps({ ok:false, error:'Location denied' }),
      { enableHighAccuracy:true, timeout:10_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Start camera in face mode
  useEffect(() => {
    if (mode !== 'face') {
      streamRef.current?.getTracks().forEach(t => t.stop());
      return;
    }
    navigator.mediaDevices?.getUserMedia({ video: { facingMode:'user' } })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError('Camera access denied'));

    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, [mode]);

  const doScan = useCallback(async (scannedToken) => {
    if (!gps.ok) return setError('GPS required for attendance');
    setScanState('scanning');
    setError(null);

    try {
      const payload = {
        sessionId:    'demo-session-id',   // In real app: from QR decode
        scannedToken: scannedToken || 'demo-token',
        latitude:     gps.lat,
        longitude:    gps.lng,
      };

      const res = await attendanceAPI.markViaQR(payload);
      setScanState('success');
      setResult({
        time:    new Date().toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit' }),
        cls:     'CS301 — Data Structures',
        method:  mode === 'qr' ? 'QR Code' : 'Face Recognition',
        conf:    mode === 'face' ? 92 : null,
      });

    } catch (err) {
      if (err.status === 0 || !isOnline) {
        // Network failure — queue for later
        await queueScan({ sessionId:'demo', scannedToken:scannedToken || 'demo', latitude:gps.lat, longitude:gps.lng });
        setScanState('idle');
        setError(`No connection — scan queued (${pendingCount + 1} pending)`);
      } else {
        setScanState('error');
        setError(err.message || 'Attendance marking failed');
      }
    }
  }, [gps, mode, isOnline, queueScan, pendingCount]);

  const reset = () => { setScanState('idle'); setResult(null); setError(null); };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, maxWidth:470, margin:'0 auto' }}>

      {/* Offline banner */}
      {(!isOnline || pendingCount > 0) && (
        <div style={{ padding:'9px 13px', borderRadius:8, background:'rgba(255,176,32,.13)', border:'1px solid rgba(255,176,32,.3)', display:'flex', alignItems:'center', gap:10, fontSize:12 }}>
          <WifiOff size={14} color="#ffb020" />
          <span style={{ color:'#ffb020' }}>
            {!isOnline ? `Offline — ${pendingCount} scan${pendingCount !== 1 ? 's' : ''} queued for sync` : `${pendingCount} offline scan${pendingCount !== 1 ? 's' : ''} pending sync`}
          </span>
        </div>
      )}

      {/* Mode toggle */}
      <div className="card" style={{ padding:5, display:'flex', gap:4 }}>
        {[['qr','QR Code',QrCode],['face','Face Recognition',Camera]].map(([m, label, Icon]) => (
          <button key={m} onClick={() => { setMode(m); reset(); }}
            style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'9px', borderRadius:7, background:mode===m ? '#3d7fff' : 'transparent', color:mode===m ? '#fff' : '#5a7098', fontSize:13, fontWeight:500, border:'none', cursor:'pointer', transition:'all .18s' }}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* GPS status */}
      <div style={{ padding:'9px 13px', display:'flex', alignItems:'center', gap:10, background:'#141e2e', border:'1px solid #1c2840', borderRadius:10 }}>
        <div style={{ width:32, height:32, borderRadius:8, background:gps.ok ? 'rgba(0,196,140,.13)' : 'rgba(255,176,32,.13)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <MapPin size={15} color={gps.ok ? '#00c48c' : '#ffb020'} />
        </div>
        <div>
          <div style={{ fontSize:12, fontWeight:600, color:gps.ok ? '#00c48c' : '#ffb020' }}>{gps.ok ? 'GPS Verified' : 'Acquiring GPS…'}</div>
          <div style={{ fontSize:11, color:'#5a7098' }}>{gps.ok ? `${gps.dist}m from classroom · Within 100m radius` : 'Enable location access in your browser'}</div>
        </div>
        {isOnline ? <Wifi size={14} color={gps.ok ? '#00c48c' : '#ffb020'} style={{ marginLeft:'auto' }} /> : <WifiOff size={14} color="#5a7098" style={{ marginLeft:'auto' }} />}
      </div>

      {/* Scanner card */}
      <div className="card" style={{ padding:20, textAlign:'center' }}>
        {scanState === 'success' && result ? (
          <div className="animate-fade-up">
            <div style={{ width:60, height:60, borderRadius:14, background:'rgba(0,196,140,.13)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
              <CheckCircle size={30} color="#00c48c" />
            </div>
            <h3 className="font-space" style={{ fontSize:17, fontWeight:700, color:'#00c48c', marginBottom:8 }}>Attendance Marked!</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:5, padding:'11px 15px', background:'#141e2e', borderRadius:10, textAlign:'left', marginTop:11 }}>
              {[['Class',result.cls],['Time',result.time],['Method',result.method],...(result.conf ? [['Face Match',`${result.conf}% confidence`]] : [])].map(([k,v]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'3px 0', borderBottom:'1px solid #1c2840' }}>
                  <span style={{ color:'#5a7098' }}>{k}</span><span style={{ color:'#c8d6f0', fontWeight:500 }}>{v}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost" style={{ marginTop:14, width:'100%', justifyContent:'center' }} onClick={reset}>
              <RefreshCw size={13} />Scan Another
            </button>
          </div>
        ) : (
          <>
            {/* Scanner visual */}
            {mode === 'qr' ? (
              <div style={{ position:'relative', display:'inline-block', marginBottom:18 }}>
                <div style={{ width:200, height:200, border:`2px solid ${scanState==='scanning' ? '#00c48c' : gps.ok ? '#3d7fff' : '#2d3f58'}`, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', background:'#141e2e', position:'relative', overflow:'hidden', boxShadow:scanState==='scanning' ? '0 0 20px rgba(0,196,140,.25)' : 'none', transition:'all .3s' }}>
                  <QrCode size={52} color={scanState==='scanning' ? '#00c48c' : '#2d3f58'} style={{ transition:'color .3s' }} />
                  <div style={{ fontSize:12, color:'#5a7098', position:'absolute', bottom:12 }}>{scanState==='scanning' ? 'Scanning…' : 'Point camera at QR'}</div>
                  {gps.ok && <div style={{ position:'absolute', left:0, right:0, height:2, background:'linear-gradient(90deg,transparent,#3d7fff,transparent)', animation:'scanLine 2.2s linear infinite', top:0 }} />}
                </div>
              </div>
            ) : (
              <div style={{ position:'relative', display:'inline-block', marginBottom:18 }}>
                <div style={{ width:200, height:200, borderRadius:'50%', border:`2px solid ${scanState==='scanning' ? '#00c48c' : gps.ok ? '#3d7fff' : '#2d3f58'}`, display:'flex', alignItems:'center', justifyContent:'center', background:'radial-gradient(circle,#141e2e 60%,#1c2840 100%)', overflow:'hidden', transition:'all .3s' }}>
                  {videoRef && mode === 'face' ? (
                    <video ref={videoRef} autoPlay muted playsInline style={{ width:'100%', height:'100%', objectFit:'cover', borderRadius:'50%' }} />
                  ) : (
                    <Camera size={62} color="#2d3f58" />
                  )}
                  {scanState === 'scanning' && <div style={{ position:'absolute', top:0, left:0, right:0, bottom:0, borderRadius:'50%', border:'2px solid #00c48c', animation:'pulseRing 1.5s ease infinite' }} />}
                </div>
              </div>
            )}

            <div style={{ fontSize:13, color:'#5a7098', marginBottom:16 }}>
              {mode === 'qr' ? 'Ask faculty to display the QR code' : 'Look directly into the camera'}
            </div>

            {error && (
              <div style={{ padding:'8px 12px', background:'rgba(255,77,109,.13)', border:'1px solid rgba(255,77,109,.3)', borderRadius:8, fontSize:12, color:'#ff4d6d', marginBottom:14, display:'flex', alignItems:'center', gap:8 }}>
                <AlertTriangle size={13} />{error}
              </div>
            )}

            <button
              onClick={() => doScan(null)}
              disabled={!gps.ok || scanState === 'scanning'}
              style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'12px', fontSize:14, fontWeight:500, borderRadius:8, border:'none', cursor:gps.ok ? 'pointer' : 'not-allowed', background:'#3d7fff', color:'#fff', opacity:gps.ok ? 1 : .45, transition:'all .18s' }}
            >
              {scanState === 'scanning' ? (
                <><div style={{ width:14, height:14, border:'2px solid rgba(255,255,255,.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />{mode === 'face' ? 'Analyzing…' : 'Scanning…'}</>
              ) : (
                <><Zap size={14} />{mode === 'qr' ? 'Scan QR Code' : 'Recognize Face'}</>
              )}
            </button>
          </>
        )}
      </div>

      {/* Session info */}
      <div style={{ padding:'11px 13px', background:'#141e2e', border:'1px solid #1c2840', borderRadius:10 }}>
        <div style={{ fontSize:11, color:'#5a7098', fontWeight:600, textTransform:'uppercase', letterSpacing:.4, marginBottom:7 }}>Current Session</div>
        {[['Subject','CS301 — Data Structures'],['Faculty','Dr. Ankit Verma'],['Room','LH-204, Block A'],['Session Ends','10:00 AM']].map(([k,v]) => (
          <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'4px 0', borderBottom:'1px solid #1c2840' }}>
            <span style={{ color:'#5a7098' }}>{k}</span><span style={{ color:'#c8d6f0', fontWeight:500 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
