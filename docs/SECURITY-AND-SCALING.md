# AttendanceAI — Security Hardening & Performance Scaling Guide

## Security Hardening Checklist

### 1. Secrets Management

```bash
# ✅ DO — Use AWS SSM Parameter Store for all secrets
aws ssm put-parameter \
  --name /attendance/prod/JWT_ACCESS_SECRET \
  --value "$(openssl rand -hex 64)" \
  --type SecureString

# ❌ DON'T — Commit .env files or paste secrets in CI
echo ".env" >> .gitignore
echo ".env.*" >> .gitignore  # but NOT .env.example
```

**Rotate secrets every 90 days:**
- JWT secrets: rotating invalidates all existing sessions (acceptable for scheduled rotation)
- Use `JWT_ACCESS_SECRET_V2` alongside `V1` for zero-downtime rotation
- MongoDB credentials: rotate via Atlas's built-in rotation
- AWS keys: not needed with OIDC — no long-lived keys to rotate

---

### 2. JWT Security

```js
// ✅ Access token: short TTL, in-memory only
{ expiresIn: '15m', issuer: 'attendance-api', audience: 'attendance-client' }

// ✅ Refresh token: httpOnly cookie (XSS-proof), Redis-backed revocation
res.cookie('refreshToken', token, {
  httpOnly: true,
  secure:   true,       // HTTPS only
  sameSite: 'strict',   // CSRF protection
  maxAge:   7 * 24 * 60 * 60 * 1000,
});

// ❌ Never store access tokens in localStorage
// (vulnerable to XSS — any injected script can steal them)
```

**Verify these in production:**
- [ ] `JWT_ACCESS_SECRET` is ≥ 64 random hex chars (256 bits)
- [ ] `JWT_REFRESH_SECRET` is different from `JWT_ACCESS_SECRET`
- [ ] Refresh tokens are being stored in Redis (verify with `redis-cli keys "refresh:*"`)
- [ ] Login failures are rate-limited (test with 11 rapid requests)

---

### 3. QR Anti-Replay

The QR fraud prevention relies on Redis being the single source of truth.
Test it:

```bash
# 1. Get a valid QR token
# 2. Scan it once (should succeed)
# 3. Scan the same token again — must return REPLAYED_TOKEN
curl -X POST .../api/attendance/mark/qr \
  -d '{"sessionId":"...","scannedToken":"<same token>","latitude":28.7,"longitude":77.1}'
# Expected: 422 REPLAYED_TOKEN
```

**QR security parameters to review:**
- `QR_TOKEN_TTL_SECS=45` — reduce to 30 for higher security, increase to 60 for slow scanners
- `QR_LOCATION_RADIUS=100` — 100m is appropriate for most college buildings (< 50m for small classrooms)
- Nonces must survive Redis restart: if Redis is restarted, old QR codes become reusable for their TTL. Use `redis-server --appendonly yes` for persistence.

---

### 4. Face Recognition Security

```python
# ✅ Strict threshold (fewer false accepts)
FACE_DISTANCE_THRESHOLD = 0.50   # dlib default is 0.60

# ✅ Every recognition event logged
logger.info(f"Recognition: student={student_id} confidence={confidence:.3f} matched={matched}")

# ✅ Minimum 80% confidence enforced
FACE_MIN_CONFIDENCE = 0.80
```

**Liveness detection (future):**
The current implementation uses still-image matching. A sophisticated attacker
could hold up a photo. Add liveness detection:
- Blink detection (track eye aspect ratio across 3 frames)
- Random head-turn challenge
- Or: use a hosted liveness API (AWS Rekognition, Azure Face)

---

### 5. Nginx Security Headers

Verify these are present in production:

```bash
curl -I https://api.attendance.university.edu/health | grep -E "Strict|Frame|Content-Type|Referrer|CSP"
```

Expected headers:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin
Content-Security-Policy: default-src 'none'
```

**Test HSTS preload eligibility:**
```bash
curl https://hstspreload.org/api/v2/status?domain=api.attendance.university.edu
```

---

### 6. Database Security

```js
// ✅ Input sanitisation (express-mongo-sanitize strips $ and .)
app.use(mongoSanitize());

// ✅ Principle of least privilege — create a read-only user for analytics
db.createUser({
  user: "analytics_reader",
  pwd: "<strong_password>",
  roles: [{ role: "read", db: "attendance_db" }]
});

// ✅ Atlas IP allowlist: only allow ECS task IPs
// (not 0.0.0.0/0 — common misconfiguration)
```

MongoDB Atlas audit log should be enabled in production (M10+ cluster).

---

### 7. Container Security

```dockerfile
# ✅ Run as non-root (already done in Dockerfiles)
USER appuser

# ✅ Read-only filesystem where possible
docker run --read-only --tmpfs /tmp attendance-backend:latest

# ✅ No new privileges
docker run --security-opt=no-new-privileges attendance-backend:latest
```

**Trivy scan before every deploy (automated in CI):**
```bash
trivy image attendance-backend:latest --severity CRITICAL,HIGH --exit-code 1
```

---

### 8. API Rate Limiting Verification

Test all rate limit zones are enforced:

```bash
# Auth endpoint: should be blocked on 11th request
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST .../api/auth/login \
    -d '{"email":"x@x.com","password":"wrong"}'
done
# Expected: 11th request returns 429

# QR scan: 6th scan in 60 seconds should be blocked
# (test with a real session and student token)
```

---

## Performance & Scaling Guide

### Current Capacity Estimates

| Tier          | Config                     | Concurrent Users | Req/sec |
|---------------|----------------------------|-----------------|---------|
| Dev           | 1 Node + 1 AI + free Atlas | ~50             | ~30     |
| Small college | 2 Node + 1 AI + Atlas M10  | ~2,000          | ~300    |
| Large college | 4 Node + 2 AI + Atlas M30  | ~20,000         | ~1,500  |
| University    | 8 Node + 4 AI + Atlas M50  | ~100,000        | ~5,000  |

---

### Bottlenecks & Solutions

#### 1. Node.js API (CPU-bound bottleneck)

The QR scan endpoint is I/O-bound (Redis + MongoDB lookups).  
It can handle ~1,000 concurrent scans per Node instance.

**Scale horizontally:**
```yaml
# docker-compose.prod.yml
deploy:
  replicas: 4        # 4 × 1,000 = 4,000 concurrent scans
```

**ECS auto-scaling:**
```json
{
  "ScalingPolicy": {
    "MetricName": "CPUUtilization",
    "TargetValue": 70,
    "ScaleOutCooldown": 60,
    "ScaleInCooldown": 300
  }
}
```

---

#### 2. Face Recognition (CPU-intensive bottleneck)

Face recognition is the most expensive operation (~300ms per scan).  
The AI service uses `uvicorn --workers 1` because face_recognition is not thread-safe.

**Scale vertically first:**
```yaml
deploy:
  resources:
    limits:
      cpus: "4.0"    # 4 cores → ~4× throughput via async queuing
```

**Scale horizontally with a load balancer:**
- Run 2–4 AI service replicas behind Nginx `least_conn`
- Each replica handles ~3 face scans/second (300ms avg × concurrency)
- For 100K users: estimate 10% face vs 90% QR → 10,000 face users
  Peak exam week: 1,000 face scans over 10 minutes = 1.7/sec → 1 replica is fine

---

#### 3. MongoDB (Query bottleneck)

Most-read collection is `Analytics` (snapshots).  
Most-written collection is `Attendance` (1 write per student per session).

**Index audit** — verify these exist:
```javascript
// Attendance collection
db.attendances.getIndexes()
// Must include:
// { studentId: 1, qrSessionId: 1 }  ← unique, prevents double-mark
// { classId: 1, lectureDate: -1 }   ← session attendance list
// { studentId: 1, lectureDate: -1 } ← student dashboard

// Analytics collection
db.analytics.getIndexes()
// Must include:
// { studentId: 1, computedAt: -1 }  ← latest snapshot per student
// { department: 1, riskLevel: 1 }   ← at-risk dashboard query
// { overallPercentage: -1 }         ← leaderboard
```

**Connection pool tuning:**
```js
// backend/src/config/db.js
mongoose.connect(MONGO_URI, {
  maxPoolSize: 20,        // increase from 10 for high concurrency
  minPoolSize: 5,         // keep connections warm
  serverSelectionTimeoutMS: 5000,
});
```

---

#### 4. Redis (Session/QR bottleneck)

Redis is single-threaded but very fast (~100K ops/sec).  
At 100K users, peak QR scan load: ~1,000 Redis ops/sec (well within limits).

**Monitor Redis memory:**
```bash
redis-cli info memory | grep "used_memory_human"
```

Key TTLs to verify:
- `refresh:{jti}` — 7 days
- `qr:active:{sessionId}` — 55 seconds (45 + 10 buffer)
- `qr:blacklist:{nonce}` — 90 seconds
- `rl:*` — rate limit windows (15 min for auth, 1 min for QR)

**Eviction policy:** Set `maxmemory-policy allkeys-lru` to prevent OOM.

---

#### 5. WebSocket (Connection limit)

Socket.io default: ~65,000 concurrent connections per Node instance (OS file descriptor limit).

For 100K concurrent connections:
```nginx
# nginx.conf
worker_rlimit_nofile 200000;
events { worker_connections 65535; }

# Sticky sessions required for WebSocket
upstream backend {
  ip_hash;  # same client always hits the same Node replica
  server backend1:3000;
  server backend2:3000;
}
```

Or switch to a Redis pub/sub architecture (already implemented!) and use
`socket.io-redis` adapter — then any Node replica can serve any WebSocket client.

---

### Performance Monitoring

**Key metrics to alert on:**

```bash
# CloudWatch alarms to create:

# 1. API response time P99 > 500ms
aws cloudwatch put-metric-alarm \
  --alarm-name attendance-api-latency \
  --metric-name TargetResponseTime \
  --threshold 0.5 \
  --comparison-operator GreaterThanThreshold

# 2. AI service response time P99 > 2s (face recognition)
# 3. MongoDB connection pool saturation > 80%
# 4. Redis memory > 70% of maxmemory
# 5. QR fraud attempts spike (> 10 in 5 min)
```

**Log analysis queries (CloudWatch Insights):**

```
# Slowest API endpoints
filter @logStream = "api"
| parse @message "* * *" as method, url, time
| stats avg(time), max(time), count() by url
| sort max(time) desc | limit 20

# Face recognition failure rate
filter @message like /face_detected=False/
| stats count() as failures by bin(5min)

# Fraud attempt patterns
filter @message like /Fraud attempt/
| parse @message "reason=*" as reason
| stats count() by reason
```

---

### Load Testing

Before going live, run a load test simulating exam-day peak:

```bash
# Install k6
brew install k6

# Run the attendance mark scenario
k6 run --vus 500 --duration 60s scripts/load-test-qr-mark.js
```

```js
// scripts/load-test-qr-mark.js
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const res = http.post(
    'https://api.attendance.university.edu/api/attendance/mark/qr',
    JSON.stringify({
      sessionId:    __ENV.SESSION_ID,
      scannedToken: __ENV.QR_TOKEN,
      latitude:     28.7041 + Math.random() * 0.001,
      longitude:    77.1025 + Math.random() * 0.001,
    }),
    { headers: { 'Authorization': `Bearer ${__ENV.TOKEN}`, 'Content-Type': 'application/json' } }
  );

  check(res, {
    'status is 201 or 409': r => r.status === 201 || r.status === 409,
    'response time < 500ms': r => r.timings.duration < 500,
  });
}
```

**Target:** P99 latency < 500ms at 500 concurrent users (simulates a 500-seat lecture theatre).

---

### Disaster Recovery

**RTO** (Recovery Time Objective): < 5 minutes  
**RPO** (Recovery Point Objective): < 1 minute

**Backup strategy:**
- MongoDB Atlas: continuous backup with point-in-time recovery (1 min granularity)
- Redis: `appendonly yes` for in-memory data persistence; QR sessions are ephemeral (acceptable loss)
- S3 face encodings: versioning enabled, cross-region replication for disaster recovery
- Model files: stored in S3, re-downloaded at container startup if needed

**Runbook — database failover:**
1. Atlas auto-fails over to secondary (< 30 seconds)
2. Node app: Mongoose reconnects automatically (built-in retry)
3. No manual intervention needed for planned Atlas maintenance

**Runbook — AI service crash:**
1. ECS restarts the container automatically (healthcheck failure → restart)
2. During restart (~30s): face attendance returns 503, frontend shows "Use QR instead"
3. Risk predictions are cached in Analytics collection — dashboard unaffected
