import { z } from 'zod';
export const respondFriendRequestSchema = z.object({
    action: z.enum(['ACCEPT', 'DECLINE']),
});
