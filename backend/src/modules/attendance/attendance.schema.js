/**
 * attendance.schema.js — Zod schemas for attendance endpoints
 */
const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId');

const createSession = z.object({
  body: z.object({
    classId:         objectId,
    latitude:        z.number().min(-90).max(90),
    longitude:       z.number().min(-180).max(180),
    radiusMeters:    z.number().min(10).max(500).optional(),
    durationMinutes: z.number().min(10).max(300).optional(),
  }),
});

const markViaQR = z.object({
  body: z.object({
    sessionId:    objectId,
    scannedToken: z.string().min(10, 'Token too short'),
    latitude:     z.number().min(-90).max(90),
    longitude:    z.number().min(-180).max(180),
  }),
});

const markViaFace = z.object({
  body: z.object({
    sessionId:   objectId,
    imageBase64: z.string().min(100, 'Image data too short'),
    latitude:    z.number().min(-90).max(90),
    longitude:   z.number().min(-180).max(180),
  }),
});

const markManual = z.object({
  params: z.object({ sessionId: objectId }),
  body: z.object({
    studentId: objectId,
    status:    z.enum(['present', 'absent', 'late', 'excused']),
    note:      z.string().max(300).optional(),
  }),
});

const sessionId = z.object({
  params: z.object({ sessionId: objectId }),
});

const studentSummary = z.object({
  params: z.object({ studentId: objectId }),
  query:  z.object({
    semester:   z.coerce.number().int().min(1).max(10).optional(),
    department: z.string().optional(),
  }),
});

module.exports = { createSession, markViaQR, markViaFace, markManual, sessionId, studentSummary };
