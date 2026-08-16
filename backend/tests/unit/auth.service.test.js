/**
 * auth.service.test.js — Unit tests for the auth service
 *
 * We mock the DB layer and Redis so tests run in milliseconds without
 * any external dependency. This is the right level to test business logic.
 */
const authService = require('../../src/modules/auth/auth.service');
const User        = require('../../src/models/User.model');
const jwtUtil     = require('../../src/utils/jwt');

// Mock all external dependencies
jest.mock('../../src/models/User.model');
jest.mock('../../src/utils/jwt');
jest.mock('../../src/config/redis', () => ({
  redis: { set: jest.fn(), del: jest.fn(), get: jest.fn() },
}));

describe('Auth Service', () => {

  beforeEach(() => jest.clearAllMocks());

  // ── register ────────────────────────────────────────────────────────────────
  describe('register()', () => {
    it('should create a new user and return tokens', async () => {
      User.findOne.mockResolvedValue(null);                       // email not taken
      User.create.mockResolvedValue({
        _id:    'user123',
        email:  'test@university.edu',
        role:   'student',
        name:   'Test Student',
        toJWTPayload: () => ({ id: 'user123', email: 'test@university.edu', role: 'student' }),
      });
      jwtUtil.signAccessToken.mockReturnValue('mock-access-token');
      jwtUtil.signRefreshToken.mockResolvedValue('mock-refresh-token');

      const result = await authService.register({
        name: 'Test Student', email: 'test@university.edu', password: 'Password1',
      });

      expect(User.findOne).toHaveBeenCalledWith({ email: 'test@university.edu' });
      expect(User.create).toHaveBeenCalledTimes(1);
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('should throw 409 when email already exists', async () => {
      User.findOne.mockResolvedValue({ email: 'exists@university.edu' });

      await expect(authService.register({
        name: 'Test', email: 'exists@university.edu', password: 'Password1',
      })).rejects.toMatchObject({ statusCode: 409, message: /already registered/i });
    });
  });

  // ── login ───────────────────────────────────────────────────────────────────
  describe('login()', () => {
    it('should login with correct credentials and return tokens', async () => {
      const mockUser = {
        _id:              'user123',
        email:            'test@university.edu',
        isActive:         true,
        comparePassword:  jest.fn().mockResolvedValue(true),
        toJWTPayload:     () => ({ id: 'user123' }),
      };
      User.findOne.mockReturnValue({ select: () => Promise.resolve(mockUser) });
      User.findByIdAndUpdate.mockResolvedValue({});
      jwtUtil.signAccessToken.mockReturnValue('access-token');
      jwtUtil.signRefreshToken.mockResolvedValue('refresh-token');

      const result = await authService.login('test@university.edu', 'Password1');

      expect(mockUser.comparePassword).toHaveBeenCalledWith('Password1');
      expect(result.accessToken).toBe('access-token');
    });

    it('should throw 401 on wrong password', async () => {
      const mockUser = {
        _id: 'u1', email: 'x@x.com', isActive: true,
        comparePassword: jest.fn().mockResolvedValue(false),
        toJWTPayload: () => ({}),
      };
      User.findOne.mockReturnValue({ select: () => Promise.resolve(mockUser) });

      await expect(authService.login('x@x.com', 'wrong'))
        .rejects.toMatchObject({ statusCode: 401 });
    });

    it('should throw 403 when account is deactivated', async () => {
      User.findOne.mockReturnValue({
        select: () => Promise.resolve({ _id: 'u1', isActive: false }),
      });

      await expect(authService.login('x@x.com', 'pass'))
        .rejects.toMatchObject({ statusCode: 403, message: /deactivated/i });
    });

    it('should throw 401 when user not found', async () => {
      User.findOne.mockReturnValue({ select: () => Promise.resolve(null) });

      await expect(authService.login('nobody@x.com', 'pass'))
        .rejects.toMatchObject({ statusCode: 401 });
    });
  });
});
