import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { asyncHandler } from '../../http/errors.js';
import { ok } from '../../http/respond.js';
import {
  createPostSchema,
  createReplySchema,
  listCommunitiesQuerySchema,
} from './schemas.js';
import {
  createPost,
  createReply,
  getCommunity,
  joinCommunity,
  leaveCommunity,
  listCommunities,
  listPosts,
  listReplies,
  togglePostLike,
} from './service.js';

const idParam = z.object({ id: z.string().uuid() });
const idOrSlugParam = z.object({ idOrSlug: z.string().min(1) });
const postParam = z.object({ postId: z.string().uuid() });

export function communitiesRouter(ctx: Ctx): Router {
  const r = Router();
  const { mw } = ctx;
  const guard = [mw.authenticate, mw.loadUser, mw.requireEligible];

  // 1. List campus communities (with optional category filter)
  r.get(
    '/',
    ...guard,
    asyncHandler(async (req, res) => {
      const q = listCommunitiesQuerySchema.parse(req.query);
      const communities = await listCommunities(ctx.pool, req.user!, q.category);
      ok(res, communities);
    }),
  );

  // 2. Get community details by id or slug
  r.get(
    '/:idOrSlug',
    ...guard,
    asyncHandler(async (req, res) => {
      const { idOrSlug } = idOrSlugParam.parse(req.params);
      const community = await getCommunity(ctx.pool, req.user!, idOrSlug);
      ok(res, community);
    }),
  );

  // 3. Join a community
  r.post(
    '/:id/join',
    ...guard,
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const result = await joinCommunity(ctx.pool, req.user!, id);
      ok(res, result);
    }),
  );

  // 4. Leave a community
  r.post(
    '/:id/leave',
    ...guard,
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const result = await leaveCommunity(ctx.pool, req.user!, id);
      ok(res, result);
    }),
  );

  // 5. List posts in a community
  r.get(
    '/:id/posts',
    ...guard,
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const posts = await listPosts(ctx.pool, req.user!, id);
      ok(res, posts);
    }),
  );

  // 6. Create a post in a community
  r.post(
    '/:id/posts',
    ...guard,
    ctx.limit.safety, // prevent rapid post spam
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = createPostSchema.parse(req.body);
      const post = await createPost(ctx.pool, req.user!, id, input);
      ok(res, post, 201);
    }),
  );

  // 7. Toggle post like
  r.post(
    '/posts/:postId/like',
    ...guard,
    asyncHandler(async (req, res) => {
      const { postId } = postParam.parse(req.params);
      const result = await togglePostLike(ctx.pool, req.user!, postId);
      ok(res, result);
    }),
  );

  // 8. List replies for a post
  r.get(
    '/posts/:postId/replies',
    ...guard,
    asyncHandler(async (req, res) => {
      const { postId } = postParam.parse(req.params);
      const replies = await listReplies(ctx.pool, req.user!, postId);
      ok(res, replies);
    }),
  );

  // 9. Post a reply
  r.post(
    '/posts/:postId/replies',
    ...guard,
    asyncHandler(async (req, res) => {
      const { postId } = postParam.parse(req.params);
      const input = createReplySchema.parse(req.body);
      const reply = await createReply(ctx.pool, req.user!, postId, input);
      ok(res, reply, 201);
    }),
  );

  return r;
}
