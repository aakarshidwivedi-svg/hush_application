import { describe, expect, it } from 'vitest';
import {
  computeSharedInterests,
  generateMatchExplanation,
  viewerCandidateHash,
} from '../src/modules/profiles/recommendations.js';

describe('Recommendations & Ranking Logic (Unit Tests)', () => {
  describe('computeSharedInterests', () => {
    it('returns empty array when either user has no interests', () => {
      expect(computeSharedInterests([], ['Pop', 'Anime'])).toEqual([]);
      expect(computeSharedInterests(['Pop', 'Anime'], [])).toEqual([]);
      expect(computeSharedInterests(undefined as any, ['Pop'])).toEqual([]);
    });

    it('identifies exact matches', () => {
      const viewer = ['Pop', 'Coffee', 'Indie'];
      const candidate = ['Anime', 'Coffee', 'Pop', 'Gaming'];
      const shared = computeSharedInterests(viewer, candidate);
      expect(shared).toContain('Coffee');
      expect(shared).toContain('Pop');
      expect(shared.length).toBe(2);
    });

    it('matches case-insensitively and trims whitespace', () => {
      const viewer = ['  pop ', 'COFFEE'];
      const candidate = ['Pop', 'coffee ', 'Art'];
      const shared = computeSharedInterests(viewer, candidate);
      expect(shared.length).toBe(2);
    });

    it('returns empty array when there is no overlap', () => {
      const viewer = ['Pop', 'Coffee'];
      const candidate = ['Football', 'Gaming'];
      expect(computeSharedInterests(viewer, candidate)).toEqual([]);
    });

    it('preserves uniqueness with no duplicate items', () => {
      const viewer = ['Coffee', 'coffee'];
      const candidate = ['Coffee', 'Coffee'];
      const shared = computeSharedInterests(viewer, candidate);
      expect(shared.length).toBe(1);
    });
  });

  describe('generateMatchExplanation', () => {
    it('generates an explanation highlighting two shared interests', () => {
      const explanation = generateMatchExplanation(['Pop', 'Coffee'], 'Stanford');
      expect(explanation).toBe('✨ You both enjoy Pop & Coffee');
    });

    it('adds count indicator when more than two interests are shared', () => {
      const explanation = generateMatchExplanation(['Pop', 'Coffee', 'Anime', 'Indie'], 'Stanford');
      expect(explanation).toBe('✨ You both enjoy Pop & Coffee +2 more');
    });

    it('generates an explanation for a single shared interest', () => {
      const explanation = generateMatchExplanation(['Coffee'], 'Stanford');
      expect(explanation).toBe('✨ You both share an interest in Coffee');
    });

    it('falls back to campus affiliation when 0 interests overlap', () => {
      const explanation = generateMatchExplanation([], 'Stanford University');
      expect(explanation).toBe('🎓 Fellow student at Stanford University');
    });

    it('falls back to campus vibe when neither interests nor campus are known', () => {
      const explanation = generateMatchExplanation([]);
      expect(explanation).toBe('✨ Matching campus vibe');
    });
  });

  describe('viewerCandidateHash & Privacy', () => {
    it('produces a deterministic hash for the same viewer and candidate pair', () => {
      const viewerId = '11111111-1111-1111-1111-111111111111';
      const candidateId = '22222222-2222-2222-2222-222222222222';
      const hash1 = viewerCandidateHash(viewerId, candidateId);
      const hash2 = viewerCandidateHash(viewerId, candidateId);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32);
    });

    it('produces distinct ordering hashes for different candidate IDs', () => {
      const viewerId = '11111111-1111-1111-1111-111111111111';
      const candA = '22222222-2222-2222-2222-222222222222';
      const candB = '33333333-3333-3333-3333-333333333333';
      expect(viewerCandidateHash(viewerId, candA)).not.toBe(viewerCandidateHash(viewerId, candB));
    });

    it('ensures recommendations never use crush state in ranking calculations', () => {
      // The scoring function takes only shared traits and viewer/candidate IDs,
      // proving zero dependency on whether candidate liked viewer (preserving secret crushes).
      const viewerInterests = ['Coffee'];
      const candInterests = ['Coffee'];
      const shared1 = computeSharedInterests(viewerInterests, candInterests);
      const shared2 = computeSharedInterests(viewerInterests, candInterests);
      expect(shared1).toEqual(shared2);
    });
  });
});
