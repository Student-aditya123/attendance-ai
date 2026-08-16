/**
 * auth.integration.test.js — End-to-end API tests with Supertest
 *
 * These tests run against a real in-memory MongoDB (via jest.setup or
 * @shelf/jest-mongodb) and a mocked Redis. They test the full HTTP stack:
 *   HTTP → middleware → controller → service → model → DB
 */
const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../../src/app');
const User     = require('../../src/models/User.model');

// Mock Redis so integration tests don't need a live Redis instance
jest.mock('../../src/config/redis', () => ({
  redis: {
    set:    jest.fn().mockResolvedValue('OK'),
    get:    jest.fn().mockResolvedValue(null),
    del:    jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    call:   jest.fn(),
  },
  redisPub: { publish: jest.fn() },
  redisSub: { subscribe: jest.fn(), on: jest.fn() },
  CHANNELS: {},
  connectRedis: jest.fn(),
}));

describe('Auth API — /api/auth', () => {

  const testUser = {
    name:     'Integration Test User',
    email:    'integration@university.edu',
    password: 'SecurePass1',
    role:     'student',
  };

  let accessToken;

  // ── POST /register ──────────────────────────────────────────────────────────
  describe('POST /api/auth/register', () => {
    it('should register a new user and return 201', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(testUser);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.email).toBe(testUser.email);
      expect(res.body.data.user.passwordHash).toBeUndefined();  // never exposed
    });

    it('should return 409 when registering duplicate email', async () => {
      await request(app).post('/api/auth/register').send(testUser);  // first registration

      const res = await request(app)
        .post('/api/auth/register')
        .send(testUser);  // duplicate

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it('should return 422 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...testUser, email: 'not-an-email' });

      expect(res.status).toBe(422);
      expect(res.body.errors).toBeDefined();
    });

    it('should return 422 for weak password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...testUser, email: 'new@x.com', password: 'weak' });

      expect(res.status).toBe(422);
    });
  });

  // ── POST /login ─────────────────────────────────────────────────────────────
  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await User.deleteMany({ email: testUser.email });
      await request(app).post('/api/auth/register').send(testUser);
    });

    it('should login with correct credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();  // httpOnly refresh cookie

      accessToken = res.body.data.accessToken;
    });

    it('should return 401 for wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: 'WrongPass1' });

      expect(res.status).toBe(401);
    });

    it('should return 401 for non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@x.com', password: 'Password1' });

      expect(res.status).toBe(401);
    });
  });

  // ── GET /me ─────────────────────────────────────────────────────────────────
  describe('GET /api/auth/me', () => {
    it('should return user profile with valid token', async () => {
      // Register + login first
      await User.deleteMany({ email: testUser.email });
      const regRes = await request(app).post('/api/auth/register').send(testUser);
      const token  = regRes.body.data.accessToken;

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(testUser.email);
    });

    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.token.here');
      expect(res.status).toBe(401);
    });
  });

  // ── Rate limiting ────────────────────────────────────────────────────────────
  describe('Rate limiting on /api/auth/login', () => {
    it('should block after 10 failed attempts in 15 minutes', async () => {
      const badLogin = () =>
        request(app)
          .post('/api/auth/login')
          .send({ email: 'x@x.com', password: 'wrong' });

      // Fire 10 failed requests
      for (let i = 0; i < 10; i++) await badLogin();

      // 11th should be rate-limited (429)
      const res = await badLogin();
      expect(res.status).toBe(429);
    }, 30_000);
  });
});
