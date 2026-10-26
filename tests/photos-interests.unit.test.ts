import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  addPhotoSchema,
  completeProfileSchema,
  reorderPhotosSchema,
  updateInterestsSchema,
} from '../src/modules/profiles/schemas.js';
import {
  MAX_FILE_SIZE,
  parseImagePayload,
  validateImageBuffer,
} from '../src/modules/photos/storage.js';

describe('Photo Validation & Storage Logic (Unit Tests)', () => {
  // Construct minimal valid buffers with format magic bytes
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const webpHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // 'RIFF'
    0x24, 0x00, 0x00, 0x00, // file size
    0x57, 0x45, 0x42, 0x50, // 'WEBP'
    0x56, 0x50, 0x38, 0x20, // 'VP8 '
  ]);

  it('accepts valid JPEG images by verifying magic bytes', () => {
    const res = validateImageBuffer(jpegHeader);
    expect(res.mimeType).toBe('image/jpeg');
    expect(res.ext).toBe('jpg');
  });

  it('accepts valid PNG images by verifying magic bytes', () => {
    const res = validateImageBuffer(pngHeader);
    expect(res.mimeType).toBe('image/png');
    expect(res.ext).toBe('png');
  });

  it('accepts valid WebP images by verifying magic bytes', () => {
    const res = validateImageBuffer(webpHeader);
    expect(res.mimeType).toBe('image/webp');
    expect(res.ext).toBe('webp');
  });

  it('rejects unsupported file formats (e.g. PDF, GIF, plain text)', () => {
    const textBuffer = Buffer.from('This is not an image');
    expect(() => validateImageBuffer(textBuffer)).toThrow(
      'Invalid image format. Only JPEG, PNG, and WebP are accepted.',
    );

    const gifBuffer = Buffer.from('GIF89a...');
    expect(() => validateImageBuffer(gifBuffer)).toThrow(
      'Invalid image format. Only JPEG, PNG, and WebP are accepted.',
    );

    const pdfBuffer = Buffer.from('%PDF-1.4...');
    expect(() => validateImageBuffer(pdfBuffer)).toThrow(
      'Invalid image format. Only JPEG, PNG, and WebP are accepted.',
    );
  });

  it('rejects empty image buffers', () => {
    expect(() => validateImageBuffer(Buffer.alloc(0))).toThrow('Image file is empty');
  });

  it('enforces maximum upload size limit (5MB)', () => {
    const oversized = Buffer.alloc(MAX_FILE_SIZE + 10);
    // Even if header matches, size must be rejected
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    expect(() => validateImageBuffer(oversized)).toThrow(/Image exceeds maximum allowed size/);
  });

  it('rejects declared MIME type mismatch', () => {
    // Pass JPEG buffer but declare it as image/png
    expect(() => validateImageBuffer(jpegHeader, 'image/png')).toThrow(
      'Image file content does not match declared MIME type',
    );
  });

  it('correctly parses base64 data URLs', () => {
    const dataUrl = `data:image/png;base64,${pngHeader.toString('base64')}`;
    const parsed = parseImagePayload(dataUrl);
    expect(parsed.mimeType).toBe('image/png');
    expect(parsed.buffer.length).toBe(pngHeader.length);
  });
});

describe('Photo Endpoints Schemas & Ordering Validation', () => {
  it('validates addPhotoSchema requires image data', () => {
    expect(() => addPhotoSchema.parse({})).toThrow();
    expect(() => addPhotoSchema.parse({ image: '' })).toThrow();
    const valid = addPhotoSchema.parse({
      image: 'data:image/jpeg;base64,abc',
      isPrimary: true,
    });
    expect(valid.isPrimary).toBe(true);
  });

  it('validates reorderPhotosSchema requires non-empty array of valid UUIDs', () => {
    expect(() => reorderPhotosSchema.parse({ photoIds: [] })).toThrow();
    expect(() => reorderPhotosSchema.parse({ photoIds: ['not-a-uuid'] })).toThrow();

    const u1 = randomUUID();
    const u2 = randomUUID();
    const valid = reorderPhotosSchema.parse({ photoIds: [u1, u2] });
    expect(valid.photoIds).toEqual([u1, u2]);
  });
});

describe('Interest Selection Constraints (Unit Tests)', () => {
  it('enforces minimum 3 interests', () => {
    const u1 = randomUUID();
    const u2 = randomUUID();
    expect(() => updateInterestsSchema.parse({ interestIds: [u1, u2] })).toThrow(
      'Pick at least 3 interests',
    );
  });

  it('enforces maximum 10 interests', () => {
    const ids = Array.from({ length: 11 }, () => randomUUID());
    expect(() => updateInterestsSchema.parse({ interestIds: ids })).toThrow(
      'Pick up to 10 interests',
    );
  });

  it('accepts between 3 and 10 valid interest UUIDs', () => {
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const valid = updateInterestsSchema.parse({ interestIds: ids });
    expect(valid.interestIds.length).toBe(5);
  });

  it('rejects invalid interest UUIDs', () => {
    expect(() =>
      updateInterestsSchema.parse({
        interestIds: [randomUUID(), randomUUID(), 'invalid-id'],
      }),
    ).toThrow();
  });
});

describe('Onboarding & Complete Profile Schema Validation', () => {
  const campusId = randomUUID();

  it('validates a complete, valid profile with photos and interests', () => {
    const interestIds = [randomUUID(), randomUUID(), randomUUID()];
    const input = {
      campusId,
      nickname: 'cool_cat.99',
      bio: 'Loves music and quiet study dates.',
      interestIds,
      photos: [
        { image: 'data:image/jpeg;base64,xyz', isPrimary: true },
        { image: 'data:image/png;base64,123' },
      ],
      discoverable: true,
      ageAttestation: true,
    };

    const parsed = completeProfileSchema.parse(input);
    expect(parsed.nickname).toBe('cool_cat.99');
    expect(parsed.interestIds?.length).toBe(3);
    expect(parsed.photos?.length).toBe(2);
  });

  it('rejects incomplete profile without 18+ age attestation', () => {
    const input = {
      campusId,
      nickname: 'student_one',
      ageAttestation: false,
    };
    expect(() => completeProfileSchema.parse(input)).toThrow(
      'You must confirm that you are 18 or older',
    );
  });

  it('rejects profile with more than 6 photos', () => {
    const input = {
      campusId,
      nickname: 'photo_lover',
      photos: Array.from({ length: 7 }, () => ({ image: 'data:image/jpeg;base64,abc' })),
      ageAttestation: true,
    };
    expect(() => completeProfileSchema.parse(input)).toThrow('Maximum 6 photos allowed');
  });

  it('rejects reserved nicknames', () => {
    const input = {
      campusId,
      nickname: 'moderator',
      ageAttestation: true,
    };
    expect(() => completeProfileSchema.parse(input)).toThrow('That nickname is reserved');
  });
});

describe('Photo Primary Uniqueness & Ordering Logic Rules', () => {
  interface MockPhoto {
    id: string;
    displayOrder: number;
    isPrimary: boolean;
  }

  function designatePrimary(photos: MockPhoto[], targetId: string): MockPhoto[] {
    return photos.map((p) => ({
      ...p,
      isPrimary: p.id === targetId,
    }));
  }

  function removePhoto(photos: MockPhoto[], deleteId: string): MockPhoto[] {
    const deleted = photos.find((p) => p.id === deleteId);
    const remaining = photos
      .filter((p) => p.id !== deleteId)
      .map((p, idx) => ({ ...p, displayOrder: idx }));

    if (deleted?.isPrimary && remaining.length > 0) {
      remaining[0]!.isPrimary = true;
    }
    return remaining;
  }

  it('ensures exactly one primary photo when setting primary', () => {
    const p1 = { id: 'p1', displayOrder: 0, isPrimary: true };
    const p2 = { id: 'p2', displayOrder: 1, isPrimary: false };
    const p3 = { id: 'p3', displayOrder: 2, isPrimary: false };

    const updated = designatePrimary([p1, p2, p3], 'p2');
    const primaries = updated.filter((p) => p.isPrimary);
    expect(primaries.length).toBe(1);
    expect(primaries[0]!.id).toBe('p2');
  });

  it('promotes the first remaining photo to primary when current primary is deleted', () => {
    const p1 = { id: 'p1', displayOrder: 0, isPrimary: true };
    const p2 = { id: 'p2', displayOrder: 1, isPrimary: false };
    const p3 = { id: 'p3', displayOrder: 2, isPrimary: false };

    const remaining = removePhoto([p1, p2, p3], 'p1');
    expect(remaining.length).toBe(2);
    expect(remaining[0]!.id).toBe('p2');
    expect(remaining[0]!.isPrimary).toBe(true);
    expect(remaining[0]!.displayOrder).toBe(0);
    expect(remaining[1]!.displayOrder).toBe(1);
  });

  describe('College Batch, Major & Campus Residence Attributes', () => {
    it('accepts valid college batch, major, and campus area in completeProfileSchema', () => {
      const res = completeProfileSchema.parse({
        campusId: randomUUID(),
        nickname: 'campus_coder',
        bio: 'Coding & coffee',
        graduationYear: "Sophomore (Class of '27)",
        major: 'Computer Science & AI',
        campusArea: 'North Campus Hostels',
        interests: ['Coding', 'Coffee', 'Anime'],
        ageAttestation: true,
      });

      expect(res.graduationYear).toBe("Sophomore (Class of '27)");
      expect(res.major).toBe('Computer Science & AI');
      expect(res.campusArea).toBe('North Campus Hostels');
    });

    it('sanitizes and permits optional college attributes when omitted', () => {
      const res = completeProfileSchema.parse({
        campusId: randomUUID(),
        nickname: 'quiet_freshman',
        bio: '',
        interests: ['Reading', 'Music', 'Cafes'],
        ageAttestation: true,
      });

      expect(res.graduationYear).toBeUndefined();
      expect(res.major).toBeUndefined();
      expect(res.campusArea).toBeUndefined();
    });
  });
});
