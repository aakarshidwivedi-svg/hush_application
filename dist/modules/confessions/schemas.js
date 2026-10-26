import { z } from 'zod';
export const CONFESSION_CATEGORIES = [
    'Crushes',
    'Campus Life',
    'Overheard',
    'Late Night',
    'Academics',
    'General',
];
export const createConfessionSchema = z.object({
    content: z
        .string()
        .trim()
        .min(5, 'Confession must be at least 5 characters')
        .max(1000, 'Confession cannot exceed 1000 characters'),
    category: z.enum(CONFESSION_CATEGORIES).default('Crushes'),
});
export const reportConfessionSchema = z.object({
    reason: z.enum(['HARASSMENT', 'DOXXING', 'HATE_SPEECH', 'INAPPROPRIATE', 'OTHER']),
    details: z.string().trim().max(500).optional(),
});
export const listConfessionsQuerySchema = z.object({
    category: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
});
export const moderateConfessionSchema = z.object({
    action: z.enum(['APPROVE', 'REJECT', 'REMOVE']),
    reason: z.string().trim().max(300).optional(),
});
