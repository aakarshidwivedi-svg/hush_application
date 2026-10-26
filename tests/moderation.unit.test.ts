import { describe, expect, it } from 'vitest';
import { isModeratorUser } from '../src/middleware/user.js';
import {
  listReportsQuerySchema,
  reviewReportSchema,
  createReportSchema,
} from '../src/modules/reports/service.js';
import type { Config } from '../src/config/env.js';

describe('Moderation Security & Service Logic (Unit Tests)', () => {
  const baseConfig: Config = {
    env: 'production',
    port: 4000,
    logLevel: 'info',
    databaseUrl: 'postgres://localhost/test',
    directUrl: undefined,
    dbPoolMax: 10,
    corsOrigins: ['http://localhost:5173'],
    trustProxy: 0,
    auth: {
      issuer: 'http://test',
      audience: 'authenticated',
      hmacSecret: undefined,
      jwksUrl: 'http://test',
    },
    moderators: new Set(['mod-subject-123', 'admin-subject-456']),
    avatarHosts: [],
    limits: {} as any,
  };

  describe('isModeratorUser authorization check', () => {
    it('returns true when auth subject matches configured moderator in production', () => {
      expect(isModeratorUser(baseConfig, 'mod-subject-123')).toBe(true);
      expect(isModeratorUser(baseConfig, 'admin-subject-456')).toBe(true);
    });

    it('returns false when auth subject is not in configured moderators in production', () => {
      expect(isModeratorUser(baseConfig, 'regular-student-789')).toBe(false);
      expect(isModeratorUser(baseConfig, undefined)).toBe(false);
      expect(isModeratorUser(baseConfig, '')).toBe(false);
    });

    it('allows designated dev moderator in development when moderators list is not configured', () => {
      const devConfig: Config = {
        ...baseConfig,
        env: 'development',
        moderators: new Set(),
      };
      expect(isModeratorUser(devConfig, 'demo-mod-admin')).toBe(true);
      expect(isModeratorUser(devConfig, 'regular-student-789')).toBe(false);
    });

    it('denies access in production when moderators list is empty', () => {
      const prodEmptyConfig: Config = {
        ...baseConfig,
        env: 'production',
        moderators: new Set(),
      };
      expect(isModeratorUser(prodEmptyConfig, 'any-user')).toBe(false);
    });
  });

  describe('listReportsQuerySchema validation', () => {
    it('parses valid status, category, and date order filters', () => {
      const parsed = listReportsQuerySchema.parse({
        status: 'OPEN',
        reason: 'HARASSMENT',
        order: 'asc',
        limit: '25',
        offset: '50',
      });
      expect(parsed.status).toBe('OPEN');
      expect(parsed.reason).toBe('HARASSMENT');
      expect(parsed.order).toBe('asc');
      expect(parsed.limit).toBe(25);
      expect(parsed.offset).toBe(50);
    });

    it('supplies safe defaults when optional filters are omitted', () => {
      const parsed = listReportsQuerySchema.parse({});
      expect(parsed.order).toBe('desc');
      expect(parsed.limit).toBe(50);
      expect(parsed.offset).toBe(0);
      expect(parsed.status).toBeUndefined();
      expect(parsed.reason).toBeUndefined();
    });

    it('rejects invalid report status', () => {
      expect(() => listReportsQuerySchema.parse({ status: 'INVALID_STATUS' })).toThrow();
    });

    it('rejects invalid reason', () => {
      expect(() => listReportsQuerySchema.parse({ reason: 'NOT_A_REASON' })).toThrow();
    });
  });

  describe('reviewReportSchema validation', () => {
    it('accepts valid review decisions with audit notes', () => {
      const parsed = reviewReportSchema.parse({
        status: 'ACTIONED',
        note: 'Confirmed community violation. Account suspended.',
      });
      expect(parsed.status).toBe('ACTIONED');
      expect(parsed.note).toBe('Confirmed community violation. Account suspended.');
    });

    it('accepts valid review decisions without notes', () => {
      const parsed = reviewReportSchema.parse({ status: 'DISMISSED' });
      expect(parsed.status).toBe('DISMISSED');
    });

    it('rejects unexpected fields to protect audit trail integrity', () => {
      expect(() =>
        reviewReportSchema.parse({
          status: 'DISMISSED',
          extraField: 'not-allowed',
        }),
      ).toThrow();
    });
  });

  describe('createReportSchema validation', () => {
    it('requires valid target UUID and recognized reason', () => {
      const parsed = createReportSchema.parse({
        targetId: '11111111-1111-1111-1111-111111111111',
        reason: 'SPAM',
        details: 'Sending spam links',
      });
      expect(parsed.reason).toBe('SPAM');
      expect(parsed.targetId).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('rejects invalid UUIDs', () => {
      expect(() =>
        createReportSchema.parse({
          targetId: 'invalid-id',
          reason: 'SPAM',
        }),
      ).toThrow();
    });
  });
});
