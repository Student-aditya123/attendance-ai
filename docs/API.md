# AttendanceAI — Complete API Reference

**Base URL:** `https://api.attendance.university.edu`  
**Internal AI service:** `http://ai-service:8000` (not public-facing)  
**Auth:** Bearer token in `Authorization` header  
**Content-Type:** `application/json`

---

## Authentication

All protected endpoints require:
```
Authorization: Bearer <access_token>
X-Device-Fingerprint: <device_hash>   (for fraud detection)
```

Access tokens expire in **15 minutes**. Use the refresh endpoint to get a new one silently.

---

### POST /api/auth/register

Register a new user account.

**Rate limit:** 10 requests / 15 min per IP

**Request body:**
```json
{
  "name":       "Arjun Mehta",
  "email":      "arjun@university.edu",
  "password":   "SecurePass1",
  "role":       "student",
  "department": "CS",
  "rollNumber": "CS21001"
}
```

| Field        | Type   | Required | Rules                                |
|--------------|--------|----------|--------------------------------------|
| `name`       | string | ✓        | 2–100 chars                          |
| `email`      | string | ✓        | Valid email, unique                  |
| `password`   | string | ✓        | ≥8 chars, 1 uppercase, 1 digit      |
| `role`       | enum   |          | `admin` `faculty` `student`          |
| `department` | string |          | 2–100 chars                          |
| `rollNumber` | string |          | Students only                        |
| `employeeId` | string |          | Faculty/admin only                   |
| `phone`      | string |          | For SMS alerts                       |

**Response 201:**
```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "user": {
      "_id": "6613abc...",
      "name": "Arjun Mehta",
      "email": "arjun@university.edu",
      "role": "student",
      "department": "CS"
    },
    "accessToken": "eyJhbGciOiJIUzI1..."
  }
}
```
> Refresh token is set as an `httpOnly` cookie — not in the response body.

**Errors:** `409` email already registered · `422` validation failed

---

### POST /api/auth/login

**Rate limit:** 10 requests / 15 min per IP · Failed attempts only

**Request body:**
```json
{ "email": "arjun@university.edu", "password": "SecurePass1" }
```

**Response 200:** Same shape as register.

```bash
curl -X POST https://api.attendance.university.edu/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"faculty1@university.edu","password":"Password@123"}' \
  -c cookies.txt     # saves httpOnly refresh token cookie
```

**Errors:** `401` invalid credentials · `403` account deactivated

---

### POST /api/auth/refresh

Exchange the httpOnly refresh token cookie for a new access token.  
No request body needed — the cookie is sent automatically.

**Response 200:**
```json
{ "success": true, "data": { "accessToken": "eyJhbGciOiJIUzI1..." } }
```

```bash
curl -X POST https://api.attendance.university.edu/api/auth/refresh \
  -b cookies.txt     # sends refresh token cookie
```

**Errors:** `401` token expired or revoked

---

### POST /api/auth/logout

Revokes the refresh token. Access token expires naturally in ≤15 min.

**Response 200:** `{ "success": true, "message": "Logged out successfully" }`

---

### GET /api/auth/me  `🔒`

Returns the authenticated user's profile.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "6613abc...",
      "name": "Arjun Mehta",
      "email": "arjun@university.edu",
      "role": "student",
      "department": "CS",
      "rollNumber": "CS21001",
      "isFaceRegistered": false,
      "lastLoginAt": "2025-03-15T09:14:00.000Z"
    }
  }
}
```

---

### PUT /api/auth/change-password  `🔒`

**Request body:**
```json
{ "currentPassword": "OldPass1", "newPassword": "NewPass1" }
```

Clears the refresh token cookie after success — forces re-login.

---

## Attendance

### POST /api/attendance/sessions  `🔒 Faculty/Admin`

Start a new QR attendance session for a lecture.

**Request body:**
```json
{
  "classId":         "6613abc000000000000001",
  "latitude":        28.7041,
  "longitude":       77.1025,
  "radiusMeters":    100,
  "durationMinutes": 90
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "sessionId":    "6613abc000000000000099",
    "expiresAt":    "2025-03-15T10:30:00.000Z",
    "tokenTtlSecs": 45,
    "qrDataUri":    "data:image/png;base64,iVBORw0..."
  }
}
```

> The QR code is a base64 PNG ready for `<img src={qrDataUri} />`.  
> It contains a signed JWT with `{sessionId, nonce, classId}`.

---

### POST /api/attendance/sessions/:sessionId/rotate  `🔒 Faculty/Admin`

Generate a new QR token (old one is immediately blacklisted).  
Call this every 45 seconds — or earlier via the "Rotate Now" button.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "qrDataUri":  "data:image/png;base64,...",
    "expiresIn":  45
  }
}
```

> This also fires a `qr:rotated` WebSocket event to all clients in the session room.

---

### DELETE /api/attendance/sessions/:sessionId  `🔒 Faculty/Admin`

End the session. Students can no longer mark attendance.

---

### GET /api/attendance/sessions/:sessionId  `🔒 Faculty/Admin`

Get all attendance records for a session.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "count": 42,
    "records": [
      {
        "_id":       "6613...",
        "studentId": { "_id": "...", "name": "Aarav Shah", "rollNumber": "CS21001", "email": "..." },
        "method":    "qr",
        "status":    "present",
        "latitude":  28.7039,
        "longitude": 77.1023,
        "distanceFromClassroom": 24,
        "markedAt":  "2025-03-15T09:06:14.000Z"
      }
    ]
  }
}
```

---

### POST /api/attendance/mark/qr  `🔒 Student`

**Rate limit:** 5 requests / 60 sec per user

Submit a QR scan for attendance.

**Request body:**
```json
{
  "sessionId":    "6613abc000000000000099",
  "scannedToken": "eyJhbGciOiJIUzI1...",
  "latitude":     28.7039,
  "longitude":    77.1023
}
```

**Anti-fraud pipeline (all must pass):**
1. Token not expired (JWT `exp`)
2. Nonce not in Redis blacklist (replay prevention)
3. GPS ≤ `radiusMeters` from classroom
4. Student not already marked in this session
5. Student enrolled in the class

**Response 201:**
```json
{
  "success": true,
  "message": "✅ Attendance marked successfully",
  "data": {
    "record": {
      "_id":     "6613...",
      "status":  "present",
      "method":  "qr",
      "markedAt": "2025-03-15T09:06:14.000Z"
    }
  }
}
```

**Error responses:**
| Status | Reason |
|--------|--------|
| `409`  | Already marked for this session |
| `422`  | REPLAYED_TOKEN / LOCATION_MISMATCH / INVALID_COORDINATES |
| `403`  | Not enrolled in this class |
| `429`  | Rate limit exceeded |

---

### POST /api/attendance/mark/face  `🔒 Student`

**Rate limit:** 20 requests / 60 sec per user

**Request body:**
```json
{
  "sessionId":   "6613abc000000000000099",
  "imageBase64": "/9j/4AAQSkZJRgAB...",
  "latitude":    28.7039,
  "longitude":   77.1023
}
```

> Image must be JPEG or PNG, base64-encoded, ≤ 10 MB.  
> The backend proxies this to the AI service at `/face/recognize`.

**Response 201:** Same shape as QR mark, with `method: "face"` and `faceMatchConfidence: 0.91`.

**Error `422`:** `LOW_FACE_CONFIDENCE` — face found but < 80% match.  
**Error `503`:** AI service unavailable — advise student to use QR.

---

### PUT /api/attendance/sessions/:sessionId/manual  `🔒 Faculty/Admin`

Override a student's attendance status (mark absent, excuse, or correct a mistake).

**Request body:**
```json
{
  "studentId": "6613abc000000000000011",
  "status":    "excused",
  "note":      "Medical leave — submitted certificate"
}
```

`status` ∈ `present` `absent` `late` `excused`

---

### GET /api/attendance/students/:studentId/summary  `🔒 Self / Faculty / Admin`

Get a student's attendance summary grouped by subject.

**Query params:** `?semester=3&department=CS`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "overall": 73.6,
    "subjects": [
      {
        "classId":     "6613...",
        "subjectCode": "CS301",
        "subjectName": "Data Structures",
        "totalClasses": 24,
        "attended":     18,
        "percentage":   75.0,
        "isAtRisk":     false
      }
    ]
  }
}
```

---

## Analytics

### GET /api/analytics/admin/overview  `🔒 Admin`

System-wide attendance overview.

**Query params:** `?department=CS`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "avgAttendance":   79.4,
    "totalStudents":   920,
    "criticalCount":   23,
    "warningCount":    157,
    "riskByDepartment": [
      { "_id": "ME", "atRisk": 63 },
      { "_id": "CS", "atRisk": 42 }
    ]
  }
}
```

---

### GET /api/analytics/admin/at-risk  `🔒 Admin`

Paginated list of at-risk students sorted by risk score.

**Query params:** `?department=CS&riskLevel=warning&page=1&limit=20`

`riskLevel` ∈ `warning` (includes critical) · `critical`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "students": [
      {
        "studentId":    { "name": "Arjun Mehta", "email": "...", "rollNumber": "CS21001", "phone": "..." },
        "department":   "CS",
        "overallPercentage": 44.0,
        "riskLevel":    "critical",
        "riskScore":    87,
        "consecutiveAbsences": 8,
        "lastAlertSentAt": "2025-03-12T02:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 180, "pages": 9 }
  }
}
```

---

### GET /api/analytics/admin/departments  `🔒 Admin`

Attendance breakdown by department, sorted by average.

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "department": "ECE", "avgAttendance": 87.0, "totalStudents": 180, "atRisk": 18 },
    { "department": "Civil", "avgAttendance": 85.0, "totalStudents": 160, "atRisk": 22 }
  ]
}
```

---

### GET /api/analytics/faculty/classes  `🔒 Faculty/Admin`

Stats for all classes the faculty member teaches.

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "classId":      "6613...",
      "subjectCode":  "CS301",
      "subjectName":  "Data Structures",
      "totalSessions": 24,
      "totalEnrolled": 62,
      "avgAttendance": 78.0
    }
  ]
}
```

---

### GET /api/analytics/heatmap/:classId  `🔒 Faculty/Admin`

Weekly attendance heatmap data for a class.

**Query params:** `?weeksBack=12`

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "date": "2025-01-06", "present": 54, "pct": 87.1 },
    { "date": "2025-01-07", "present": 48, "pct": 77.4 }
  ]
}
```

---

### GET /api/analytics/leaderboard  `🔒 All roles`

Top students by attendance percentage.

**Query params:** `?department=CS&semester=3&limit=10`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "rank":             1,
      "student":          { "name": "Ananya Krishnan", "rollNumber": "CS21003", "department": "CS" },
      "percentage":       98.5,
      "totalAttended":    192,
      "consecutiveAbsences": 0
    }
  ]
}
```

---

### GET /api/analytics/export/:classId  `🔒 Faculty/Admin`

Export attendance data for a class.

**Query params:** `?startDate=2025-01-01&endDate=2025-03-31&format=csv`

`format` ∈ `json` (default) · `csv`

For CSV, response `Content-Type: text/csv` with `Content-Disposition: attachment`.

```bash
curl -O "https://api.attendance.university.edu/api/analytics/export/6613abc...?format=csv" \
  -H "Authorization: Bearer $TOKEN"
```

---

## AI Service (Internal)

> These endpoints are on `http://ai-service:8000` — not exposed publicly.  
> Called only by the Node.js backend via Docker internal network.

### POST /face/enroll

Register a student's face from 1–5 photos.

**Request body:**
```json
{
  "student_id":     "6613abc000000000000011",
  "images_base64":  ["data:image/jpeg;base64,...", "..."],
  "overwrite":      false
}
```

**Response 201:**
```json
{
  "success":          true,
  "student_id":       "6613abc000000000000011",
  "encodings_stored": 3,
  "storage_key":      "encodings/6613abc000000000000011.npy",
  "message":          "Face enrolled successfully using 3 sample(s)."
}
```

**Response 409:** Encoding already exists (set `overwrite: true` to replace).

---

### POST /face/recognize

Match a live face image against a student's stored encoding.

**Request body:**
```json
{
  "student_id":   "6613abc000000000000011",
  "image_base64": "/9j/4AAQSkZJRgAB...",
  "session_id":   "6613abc000000000000099"
}
```

**Response 200:**
```json
{
  "matched":             true,
  "confidence":          0.9143,
  "student_id":          "6613abc000000000000011",
  "face_detected":       true,
  "processing_time_ms":  312.4,
  "message":             "Identity verified."
}
```

**Confidence thresholds:**
- `≥ 0.80` → matched (configurable via `FACE_MIN_CONFIDENCE`)
- `< 0.80` → rejected, `LOW_FACE_CONFIDENCE` fraud event logged

---

### GET /face/status/:student_id

Quick enrollment status check.

**Response 200:** `{ "student_id": "...", "enrolled": true }`

---

### DELETE /face/enroll/:student_id

GDPR-compliant face data deletion.

**Response 200:** `{ "success": true, "message": "Face encoding permanently deleted" }`

---

### POST /predict/risk

Predict dropout risk for one student.

**Request body:**
```json
{
  "student_id":              "6613abc000000000000011",
  "overall_percentage":      65.0,
  "consecutive_absences":    4,
  "days_since_last_attendance": 6,
  "trend_delta_4w":          -3.5,
  "subject_records": [
    {
      "class_id":      "6613abc000000000000001",
      "subject_code":  "CS301",
      "total_classes": 24,
      "attended":      15,
      "percentage":    62.5,
      "weekly_trend":  [
        { "week": 1, "percentage": 70.0 },
        { "week": 2, "percentage": 65.0 },
        { "week": 3, "percentage": 60.0 },
        { "week": 4, "percentage": 57.5 }
      ]
    }
  ]
}
```

**Response 200:**
```json
{
  "student_id":        "6613abc000000000000011",
  "risk_score":        68.5,
  "risk_level":        "warning",
  "risk_probability":  0.685,
  "top_risk_factors":  [
    "Below minimum threshold: 65% (req 75%)",
    "Absence streak: 4 consecutive classes missed",
    "Declining trend: dropped 3.5pp in 4 weeks"
  ],
  "recommendation":    "Send attendance warning email. Faculty follow-up recommended.",
  "model_version":     "2.1"
}
```

**Risk levels:**
| Level      | Condition | Risk score |
|------------|-----------|------------|
| `good`     | ≥ 85%     | 0–20       |
| `moderate` | 75–84%    | 20–40      |
| `warning`  | 60–74%    | 40–70      |
| `critical` | < 60%     | 70–100     |

---

### POST /predict/batch

Bulk inference — processes up to 5,000 students per request.

**Request body:** `{ "students": [ <PredictRiskRequest>, ... ] }`

**Response 200:**
```json
{
  "predictions":   [ ... ],
  "processed":     920,
  "failed":        0,
  "model_version": "2.1"
}
```

Typically < 2 seconds for 1,000 students (vectorised sklearn inference).

---

### GET /predict/model/info

Returns model metadata and feature importances.

**Response 200:**
```json
{
  "status":        "loaded",
  "version":       "2.1",
  "model_type":    "LogisticRegression (CalibratedClassifierCV, isotonic)",
  "features":      ["overall_pct", "trend_delta_4w", "consecutive_absences", "days_since_last", "subjects_at_risk", "worst_subject_pct", "week_variance"],
  "feature_importances": {
    "overall_pct":          0.8234,
    "consecutive_absences": 0.4521,
    "trend_delta_4w":       0.3102,
    "days_since_last":      0.2341,
    "worst_subject_pct":    0.1987,
    "subjects_at_risk":     0.1543,
    "week_variance":        0.0987
  },
  "training_metrics": {
    "accuracy":     1.0,
    "auc_roc":      1.0,
    "cv_auc_mean":  1.0,
    "cv_auc_std":   0.0
  }
}
```

---

## WebSocket Events

Connect to `wss://api.attendance.university.edu/socket.io/` with:

```js
const socket = io('wss://api.attendance.university.edu', {
  auth: { token: accessToken },
  transports: ['websocket']
});
```

### Rooms

| Room | Who joins | How |
|------|-----------|-----|
| `user:{userId}` | Auto on connect | — |
| `admin` | Admin users | Auto on connect |
| `session:{sessionId}` | Faculty + students | `socket.emit('join:session', sessionId)` |

### Events received

**`attendance:marked`** — New attendance record created
```json
{
  "sessionId":   "...",
  "studentId":   "...",
  "classId":     "...",
  "subjectCode": "CS301",
  "recordId":    "...",
  "markedAt":    "2025-03-15T09:06:14.000Z"
}
```

**`attendance:fraud`** — Fraud attempt detected
```json
{
  "sessionId": "...",
  "studentId": "...",
  "reason":    "LOCATION_MISMATCH",
  "latitude":  28.7500,
  "longitude": 77.2000
}
```

**`qr:rotated`** — New QR token generated
```json
{
  "sessionId":  "...",
  "qrDataUri":  "data:image/png;base64,...",
  "expiresIn":  45
}
```

**`notification`** — Personal alert (e.g. low attendance)
```json
{
  "type":    "LOW_ATTENDANCE",
  "message": "Your attendance is at 68.5%. Minimum required: 75%.",
  "level":   "warning"
}
```

---

## Error Response Format

All errors follow this structure:

```json
{
  "success": false,
  "message": "Human-readable error description",
  "errors":  [
    { "field": "body.email", "message": "Invalid email format" }
  ]
}
```

`errors` array only present on `422` validation failures.

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | OK |
| `201` | Created |
| `400` | Bad request (invalid ObjectId, malformed JSON) |
| `401` | Unauthenticated (missing/invalid/expired token) |
| `403` | Forbidden (wrong role) |
| `404` | Not found |
| `409` | Conflict (duplicate, already marked) |
| `422` | Validation error (Zod schema failure) |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `503` | AI service unavailable |
