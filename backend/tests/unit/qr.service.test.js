/**
 * qr.service.test.js — Unit tests for QR token validation
 */
const qrService = require('../../src/modules/attendance/qr.service');

// Mock Redis
const mockRedis = {
  exists:  jest.fn(),
  get:     jest.fn(),
  setex:   jest.fn().mockResolvedValue('OK'),
  del:     jest.fn().mockResolvedValue(1),
};
const mockPub = { publish: jest.fn().mockResolvedValue(1) };

jest.mock('../../src/config/redis', () => ({
  redis:    mockRedis,
  redisPub: mockPub,
  CHANNELS: { QR_ROTATED: 'attendance:qr_rotated' },
}));

jest.mock('../../src/models/QRSession.model');
jest.mock('../../src/config/env', () => ({
  QR_TOKEN_TTL_SECS:  45,
  QR_LOCATION_RADIUS: 100,
  JWT_ACCESS_SECRET:  'test-secret-that-is-long-enough-for-jwt-signing',
}));

describe('QR Service — validateToken()', () => {

  beforeEach(() => jest.clearAllMocks());

  it('should return invalid when nonce is blacklisted (replay attack)', async () => {
    mockRedis.exists.mockResolvedValue(1);  // blacklisted

    const result = await qrService.validateToken('session123', 'old-nonce');

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('REPLAYED_TOKEN');
    expect(mockRedis.exists).toHaveBeenCalledWith(expect.stringContaining('old-nonce'));
  });

  it('should return invalid when active nonce does not match', async () => {
    mockRedis.exists.mockResolvedValue(0);          // not blacklisted
    mockRedis.get
      .mockResolvedValueOnce('different-nonce')     // active nonce in Redis
      .mockResolvedValueOnce(null);                 // session meta

    const result = await qrService.validateToken('session123', 'scanned-nonce');

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('EXPIRED_OR_INVALID_TOKEN');
  });

  it('should return valid when nonce matches and session exists', async () => {
    const sessionMeta = { classId: 'class1', latitude: 28.7, longitude: 77.1, radiusMeters: 100 };

    mockRedis.exists.mockResolvedValue(0);          // not blacklisted
    mockRedis.get
      .mockResolvedValueOnce('correct-nonce')       // active nonce matches
      .mockResolvedValueOnce(JSON.stringify(sessionMeta));  // session meta

    const result = await qrService.validateToken('session123', 'correct-nonce');

    expect(result.valid).toBe(true);
    expect(result.session).toMatchObject({ classId: 'class1' });
  });
});
