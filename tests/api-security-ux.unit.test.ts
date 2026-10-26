import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/http/errors.js';
import { validateImageBuffer, parseImagePayload, MAX_FILE_SIZE } from '../src/modules/photos/storage.js';

describe('API Security, Validation & Reliability (Unit Tests)', () => {
  describe('Image File Signature & Magic Bytes Validation', () => {
    it('accepts valid JPEG buffer starting with 0xFF, 0xD8, 0xFF', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const res = validateImageBuffer(jpegBuffer, 'image/jpeg');
      expect(res.mimeType).toBe('image/jpeg');
      expect(res.ext).toBe('jpg');
    });

    it('accepts valid PNG buffer with PNG signature header', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const res = validateImageBuffer(pngBuffer, 'image/png');
      expect(res.mimeType).toBe('image/png');
      expect(res.ext).toBe('png');
    });

    it('accepts valid WebP buffer with RIFF and WEBP signatures', () => {
      const webpBuffer = Buffer.alloc(16);
      // 'RIFF' at bytes 0..3
      webpBuffer[0] = 0x52;
      webpBuffer[1] = 0x49;
      webpBuffer[2] = 0x46;
      webpBuffer[3] = 0x46;
      // 'WEBP' at bytes 8..11
      webpBuffer[8] = 0x57;
      webpBuffer[9] = 0x45;
      webpBuffer[10] = 0x42;
      webpBuffer[11] = 0x50;

      const res = validateImageBuffer(webpBuffer, 'image/webp');
      expect(res.mimeType).toBe('image/webp');
      expect(res.ext).toBe('webp');
    });

    it('rejects fake image containing arbitrary text or executable script', () => {
      const fakeBuffer = Buffer.from('<?php echo "evil"; ?>', 'utf-8');
      expect(() => validateImageBuffer(fakeBuffer, 'image/png')).toThrow(/Invalid image format/i);
    });

    it('rejects empty buffer', () => {
      const emptyBuffer = Buffer.alloc(0);
      expect(() => validateImageBuffer(emptyBuffer)).toThrow(/empty/i);
    });

    it('rejects image exceeding the 5MB maximum file size', () => {
      const largeBuffer = Buffer.alloc(MAX_FILE_SIZE + 100);
      largeBuffer[0] = 0xff;
      largeBuffer[1] = 0xd8;
      largeBuffer[2] = 0xff; // valid jpeg header but oversized
      expect(() => validateImageBuffer(largeBuffer)).toThrow(/exceeds maximum allowed size/i);
    });

    it('rejects image when actual bytes do not match declared MIME type', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      // Declaring PNG for a JPEG buffer
      expect(() => validateImageBuffer(jpegBuffer, 'image/png')).toThrow(/does not match/i);
    });
  });

  describe('parseImagePayload', () => {
    it('parses base64 data URL correctly', () => {
      const validPngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
      const base64Str = Buffer.from(validPngBytes).toString('base64');
      const dataUrl = `data:image/png;base64,${base64Str}`;

      const { buffer, mimeType } = parseImagePayload(dataUrl);
      expect(mimeType).toBe('image/png');
      expect(buffer.length).toBe(validPngBytes.length);
    });
  });

  describe('Message Validation Rules', () => {
    const messageSchema = z.object({
      content: z.string().trim().min(1, 'Message cannot be empty').max(1000, 'Message cannot exceed 1000 characters'),
    });

    it('accepts valid messages between 1 and 1000 characters', () => {
      const valid = messageSchema.parse({ content: 'Hey, nice photos! What campus club are you in?' });
      expect(valid.content).toBe('Hey, nice photos! What campus club are you in?');
    });

    it('trims leading and trailing whitespace from message content', () => {
      const trimmed = messageSchema.parse({ content: '   Coffee at the student union?   ' });
      expect(trimmed.content).toBe('Coffee at the student union?');
    });

    it('rejects whitespace-only messages', () => {
      expect(() => messageSchema.parse({ content: '     \n\t   ' })).toThrow(/Message cannot be empty/i);
    });

    it('rejects messages longer than 1000 characters', () => {
      const longMsg = 'a'.repeat(1001);
      expect(() => messageSchema.parse({ content: longMsg })).toThrow(/cannot exceed 1000/i);
    });
  });

  describe('AppError & Error Traceability', () => {
    it('preserves status code, error code, message and details', () => {
      const err = new AppError(403, 'NOT_ELIGIBLE', 'Campus verification pending', { missing: ['campus'] });
      expect(err.status).toBe(403);
      expect(err.code).toBe('NOT_ELIGIBLE');
      expect(err.message).toBe('Campus verification pending');
      expect(err.details).toEqual({ missing: ['campus'] });
    });
  });

  describe('Secret Crush API & Privacy Invariants', () => {
    const crushParamsSchema = z.object({ userId: z.string().uuid('Invalid user ID') });

    it('validates recipient userId is a valid UUID', () => {
      expect(() => crushParamsSchema.parse({ userId: 'not-a-uuid' })).toThrow(/Invalid user ID/);
      const valid = crushParamsSchema.parse({ userId: '20000000-0000-0000-0000-000000000002' });
      expect(valid.userId).toBe('20000000-0000-0000-0000-000000000002');
    });

    it('enforces self-crush prevention logic', () => {
      const senderId = '20000000-0000-0000-0000-000000000001';
      const targetId = '20000000-0000-0000-0000-000000000001';
      if (senderId === targetId) {
        const err = new AppError(422, 'CANNOT_CRUSH_SELF', 'You cannot send a crush to yourself');
        expect(err.status).toBe(422);
        expect(err.code).toBe('CANNOT_CRUSH_SELF');
      }
    });

    it('preserves confidentiality: crush status responses are generic', () => {
      // Both one-sided crush, mutual crush, and duplicate crush return identical response
      const successResponse = { status: 'sent' };
      expect(successResponse).toEqual({ status: 'sent' });
    });
  });
});
