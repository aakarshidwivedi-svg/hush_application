import { describe, expect, it } from 'vitest';
import { devStore } from '../src/db/devStore.js';
import {
  createConfessionSchema,
  moderateConfessionSchema,
  reportConfessionSchema,
} from '../src/modules/confessions/schemas.js';

describe('Campus Confessions & Safety (Unit Tests)', () => {
  const campusA = '11111111-1111-1111-1111-111111111111';
  const campusB = '22222222-2222-2222-2222-222222222222';
  const user1 = '20000000-0000-0000-0000-000000000001';
  const user2 = '20000000-0000-0000-0000-000000000002';

  describe('Validation & Doxxing Protections', () => {
    it('validates confession length (min 5, max 1000)', () => {
      expect(() => createConfessionSchema.parse({ content: 'hi', category: 'Crushes' })).toThrow();
      expect(() => createConfessionSchema.parse({ content: '   ', category: 'Crushes' })).toThrow();
      expect(() =>
        createConfessionSchema.parse({ content: 'a'.repeat(1001), category: 'Crushes' }),
      ).toThrow();

      const valid = createConfessionSchema.parse({
        content: 'Loved the campus festival acoustic set today! ✨',
        category: 'Campus Life',
      });
      expect(valid.content).toBe('Loved the campus festival acoustic set today! ✨');
      expect(valid.category).toBe('Campus Life');
    });

    it('defaults category to Crushes if not provided', () => {
      const res = createConfessionSchema.parse({
        content: 'Secretly admiring someone from the robotics lab 🤖',
      });
      expect(res.category).toBe('Crushes');
    });

    it('validates report reasons and moderation actions', () => {
      expect(reportConfessionSchema.parse({ reason: 'HARASSMENT' }).reason).toBe('HARASSMENT');
      expect(reportConfessionSchema.parse({ reason: 'DOXXING' }).reason).toBe('DOXXING');
      expect(() => reportConfessionSchema.parse({ reason: 'INVALID_REASON' })).toThrow();

      expect(moderateConfessionSchema.parse({ action: 'APPROVE' }).action).toBe('APPROVE');
      expect(moderateConfessionSchema.parse({ action: 'REMOVE' }).action).toBe('REMOVE');
      expect(() => moderateConfessionSchema.parse({ action: 'INVALID_ACTION' })).toThrow();
    });
  });

  describe('Author Privacy & Campus Scoping', () => {
    it('never exposes authorId in student feed', () => {
      const created = devStore.createConfession(
        campusA,
        user1,
        'Secret crush on the student wearing the vintage varsity jacket!',
        'Crushes',
        'APPROVED',
      );

      const feed = devStore.getCampusConfessions(campusA, user2, 'Crushes');
      const found = feed.find((c) => c.id === created.id);

      expect(found).toBeDefined();
      expect((found as any).authorId).toBeUndefined();
      expect(found?.content).toBe('Secret crush on the student wearing the vintage varsity jacket!');
    });

    it('isolates confessions by campus boundary', () => {
      const campusAConfession = devStore.createConfession(
        campusA,
        user1,
        'Campus A exclusive announcement',
        'General',
        'APPROVED',
      );
      const campusBConfession = devStore.createConfession(
        campusB,
        user2,
        'Campus B exclusive announcement',
        'General',
        'APPROVED',
      );

      const feedA = devStore.getCampusConfessions(campusA, user1, 'General');
      const feedB = devStore.getCampusConfessions(campusB, user2, 'General');

      expect(feedA.some((c) => c.id === campusAConfession.id)).toBe(true);
      expect(feedA.some((c) => c.id === campusBConfession.id)).toBe(false);

      expect(feedB.some((c) => c.id === campusBConfession.id)).toBe(true);
      expect(feedB.some((c) => c.id === campusAConfession.id)).toBe(false);
    });
  });

  describe('Interactive Reactions & Like Toggle', () => {
    it('toggles like reaction correctly and tracks user like state', () => {
      const conf = devStore.createConfession(
        campusA,
        user1,
        'Who else is pulling an all-nighter for midterm exams? ☕',
        'Late Night',
        'APPROVED',
      );

      // First like
      const like1 = devStore.toggleConfessionLike(conf.id, user2);
      expect(like1.liked).toBe(true);
      expect(like1.likesCount).toBe(1);

      let feed = devStore.getCampusConfessions(campusA, user2, 'Late Night');
      let item = feed.find((c) => c.id === conf.id);
      expect(item?.hasLiked).toBe(true);
      expect(item?.likesCount).toBe(1);

      // Second like (un-like)
      const like2 = devStore.toggleConfessionLike(conf.id, user2);
      expect(like2.liked).toBe(false);
      expect(like2.likesCount).toBe(0);

      feed = devStore.getCampusConfessions(campusA, user2, 'Late Night');
      item = feed.find((c) => c.id === conf.id);
      expect(item?.hasLiked).toBe(false);
      expect(item?.likesCount).toBe(0);
    });
  });

  describe('Safety Reporting & Auto-Quarantine', () => {
    it('quarantines confession when report threshold is reached', () => {
      const conf = devStore.createConfession(
        campusA,
        user1,
        'Suspicious post needing community moderation',
        'General',
        'APPROVED',
      );

      devStore.reportConfession(conf.id, 'user-a', 'HARASSMENT');
      devStore.reportConfession(conf.id, 'user-b', 'HARASSMENT');

      // Still visible with 2 reports
      let feed = devStore.getCampusConfessions(campusA, user2, 'General');
      expect(feed.some((c) => c.id === conf.id)).toBe(true);

      // 3rd report triggers automatic quarantine (status: PENDING)
      devStore.reportConfession(conf.id, 'user-c', 'HARASSMENT');

      feed = devStore.getCampusConfessions(campusA, user2, 'General');
      expect(feed.some((c) => c.id === conf.id)).toBe(false);

      // Visible in moderation queue for review
      const modQueue = devStore.getModerationConfessions('PENDING');
      expect(modQueue.some((c) => c.id === conf.id)).toBe(true);

      // Moderator approves
      devStore.moderateConfession(conf.id, 'APPROVE', 'moderator-admin');
      feed = devStore.getCampusConfessions(campusA, user2, 'General');
      expect(feed.some((c) => c.id === conf.id)).toBe(true);
    });
  });
});
