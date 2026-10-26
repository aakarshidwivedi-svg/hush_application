import { z } from 'zod';
export const listCommunitiesQuerySchema = z.object({
    category: z.string().trim().max(50).optional(),
});
export const createPostSchema = z.object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200, 'Title cannot exceed 200 characters'),
    content: z.string().trim().min(5, 'Post must be at least 5 characters').max(3000, 'Post cannot exceed 3000 characters'),
});
export const createReplySchema = z.object({
    content: z.string().trim().min(1, 'Reply cannot be empty').max(1000, 'Reply cannot exceed 1000 characters'),
});
