/**
 * auth.schema.js — Zod validation schemas for auth endpoints
 */
const { z } = require('zod');

const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Must contain at least one number');

const register = z.object({
  body: z.object({
    name:       z.string().min(2).max(100).trim(),
    email:      z.string().email().toLowerCase(),
    password:   passwordRule,
    role:       z.enum(['admin', 'faculty', 'student']).optional(),
    department: z.string().min(2).max(100).trim().optional(),
    rollNumber: z.string().trim().optional(),
    employeeId: z.string().trim().optional(),
    phone:      z.string().trim().optional(),
  }),
});

const login = z.object({
  body: z.object({
    email:    z.string().email().toLowerCase(),
    password: z.string().min(1, 'Password is required'),
  }),
});

const refreshToken = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token required'),
  }),
});

const changePassword = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword:     passwordRule,
  }),
});

const forgotPassword = z.object({
  body: z.object({
    email: z.string().email().toLowerCase(),
  }),
});

module.exports = { register, login, refreshToken, changePassword, forgotPassword };
