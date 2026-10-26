import { describe, expect, it } from 'vitest';
import { devStore } from '../src/db/devStore.js';
import { respondFriendRequestSchema } from '../src/modules/friendships/schemas.js';
import {
  createPostSchema,
  createReplySchema,
  listCommunitiesQuerySchema,
} from '../src/modules/communities/schemas.js';
import type { CurrentUser } from '../src/modules/shared/eligibility.js';

describe('Friendships & Campus Communities (Unit Tests)', () => {
  const campusId = '11111111-1111-1111-1111-111111111111';
  const user1: CurrentUser = {
    id: '20000000-0000-0000-0000-000000000001',
    authSubject: 'auth-user-1',
    campusId,
    campusName: 'Riverdale State University',
    campusActive: true,
    campusConfig: { emailDomains: ['riverdale.edu'] },
    ageStatus: 'VERIFIED',
    campusStatus: 'VERIFIED',
    status: 'ACTIVE',
  };
  const user2: CurrentUser = {
    id: '20000000-0000-0000-0000-000000000002',
    authSubject: 'auth-user-2',
    campusId,
    campusName: 'Riverdale State University',
    campusActive: true,
    campusConfig: { emailDomains: ['riverdale.edu'] },
    ageStatus: 'VERIFIED',
    campusStatus: 'VERIFIED',
    status: 'ACTIVE',
  };
  const user3: CurrentUser = {
    id: '20000000-0000-0000-0000-000000000003',
    authSubject: 'auth-user-3',
    campusId,
    campusName: 'Riverdale State University',
    campusActive: true,
    campusConfig: { emailDomains: ['riverdale.edu'] },
    ageStatus: 'VERIFIED',
    campusStatus: 'VERIFIED',
    status: 'ACTIVE',
  };
  const user4: CurrentUser = {
    id: '20000000-0000-0000-0000-000000000004',
    authSubject: 'auth-user-4',
    campusId,
    campusName: 'Riverdale State University',
    campusActive: true,
    campusConfig: { emailDomains: ['riverdale.edu'] },
    ageStatus: 'VERIFIED',
    campusStatus: 'VERIFIED',
    status: 'ACTIVE',
  };

  describe('Friendship Requests & Connections', () => {
    it('validates response actions (ACCEPT, DECLINE)', () => {
      expect(respondFriendRequestSchema.parse({ action: 'ACCEPT' }).action).toBe('ACCEPT');
      expect(respondFriendRequestSchema.parse({ action: 'DECLINE' }).action).toBe('DECLINE');
      expect(() => respondFriendRequestSchema.parse({ action: 'IGNORE' })).toThrow();
    });

    it('prevents sending a friend request to oneself', () => {
      expect(() => devStore.sendFriendRequest(user1, user1.id)).toThrowError(/Cannot send friend request to yourself/);
    });

    it('sends friend request and receiver sees pending request with sender metadata', () => {
      // User 4 sends request to User 3
      const sendRes = devStore.sendFriendRequest(user4, user3.id);
      expect(sendRes.status).toBe('sent');

      const incoming = devStore.listFriendRequests(user3.id);
      const req = incoming.find((r) => r.sender.id === user4.id);
      expect(req).toBeDefined();
      expect(req?.sender.nickname).toBe('Alex Chen');
      expect(req?.sender.major).toBe('Economics & Finance');
    });

    it('accepting a friend request creates a connection and removes pending request', () => {
      // User 3 responds ACCEPT to User 4's request
      const incoming = devStore.listFriendRequests(user3.id);
      const req = incoming.find((r) => r.sender.id === user4.id);
      expect(req).toBeDefined();

      const respondRes = devStore.respondFriendRequest(user3.id, req!.id, 'ACCEPT');
      expect(respondRes.status).toBe('ACCEPTED');

      // Check User 3's connections
      const conns3 = devStore.listConnections(user3.id);
      expect(conns3.some((c) => c.partner.id === user4.id)).toBe(true);

      // Check User 4's connections (symmetric)
      const conns4 = devStore.listConnections(user4.id);
      expect(conns4.some((c) => c.partner.id === user3.id)).toBe(true);

      // Incoming pending should no longer contain this request
      const updatedIncoming = devStore.listFriendRequests(user3.id);
      expect(updatedIncoming.some((r) => r.id === req!.id)).toBe(false);
    });

    it('removing a connection removes it for both partners', () => {
      devStore.removeConnection(user3.id, user4.id);
      const conns3 = devStore.listConnections(user3.id);
      expect(conns3.some((c) => c.partner.id === user4.id)).toBe(false);
      const conns4 = devStore.listConnections(user4.id);
      expect(conns4.some((c) => c.partner.id === user3.id)).toBe(false);
    });

    it('auto-connects when reciprocal request is sent', () => {
      devStore.removeConnection(user2.id, user4.id);
      for (const req of devStore.listFriendRequests(user2.id)) {
        if (req.sender.id === user4.id) devStore.respondFriendRequest(user2.id, req.id, 'DECLINE');
      }
      for (const req of devStore.listFriendRequests(user4.id)) {
        if (req.sender.id === user2.id) devStore.respondFriendRequest(user4.id, req.id, 'DECLINE');
      }

      // User 2 sends request to User 4
      const res1 = devStore.sendFriendRequest(user2, user4.id);
      expect(res1.status).toBe('sent');

      // User 4 sends reciprocal request to User 2 -> auto connects!
      const res2 = devStore.sendFriendRequest(user4, user2.id);
      expect(res2.status).toBe('already_connected');

      const conns2 = devStore.listConnections(user2.id);
      expect(conns2.some((c) => c.partner.id === user4.id)).toBe(true);
    });
  });

  describe('Campus Communities', () => {
    it('validates post creation schema and title/content limits', () => {
      expect(() => createPostSchema.parse({ title: 'Hi', content: 'Short' })).toThrow();
      expect(() => createPostSchema.parse({ title: 'a'.repeat(201), content: 'Valid content here' })).toThrow();
      const valid = createPostSchema.parse({
        title: 'Looking for hackathon teammates!',
        content: 'We need one React and one Python dev for this weekend.',
      });
      expect(valid.title).toBe('Looking for hackathon teammates!');
    });

    it('validates reply schema', () => {
      expect(() => createReplySchema.parse({ content: '' })).toThrow();
      const valid = createReplySchema.parse({ content: 'Interested! Sent a DM.' });
      expect(valid.content).toBe('Interested! Sent a DM.');
    });

    it('lists campus communities and filters by category', () => {
      const all = devStore.listCommunities(campusId, user1.id);
      expect(all.length).toBeGreaterThanOrEqual(7);

      const techOnly = devStore.listCommunities(campusId, user1.id, 'Tech');
      expect(techOnly.every((c) => c.category === 'Tech')).toBe(true);
      expect(techOnly.some((c) => c.name.includes('Coding'))).toBe(true);
    });

    it('joins and leaves a community, updating memberCount and isMember', () => {
      const all = devStore.listCommunities(campusId, user1.id);
      const comm = all.find((c) => c.slug === 'indie-music')!;
      const initialCount = comm.memberCount;

      const joinRes = devStore.joinCommunity(user1.id, comm.id);
      expect(joinRes.joined).toBe(true);

      const updated = devStore.getCommunity(campusId, user1.id, comm.slug);
      expect(updated.isMember).toBe(true);
      expect(updated.memberCount).toBe(initialCount + 1);

      const leaveRes = devStore.leaveCommunity(user1.id, comm.id);
      expect(leaveRes.joined).toBe(false);

      const afterLeave = devStore.getCommunity(campusId, user1.id, comm.slug);
      expect(afterLeave.isMember).toBe(false);
      expect(afterLeave.memberCount).toBe(initialCount);
    });

    it('creates a post in a community and increments post count', () => {
      const comm = devStore.getCommunity(campusId, user1.id, 'coding-ai');
      const initialPosts = comm.postCount;

      const post = devStore.createCommunityPost(user1, comm.id, {
        title: 'Weekly LeetCode discussion thread',
        content: 'Let us solve 3 graph problems this Thursday evening in the CS lounge!',
      });
      expect(post.title).toBe('Weekly LeetCode discussion thread');
      expect(post.author.id).toBe(user1.id);
      expect(post.author.nickname).toBe('Maya Sharma');

      const afterPosts = devStore.getCommunity(campusId, user1.id, 'coding-ai');
      expect(afterPosts.postCount).toBe(initialPosts + 1);

      const list = devStore.listCommunityPosts(comm.id, user1.id);
      expect(list.some((p) => p.id === post.id)).toBe(true);
    });

    it('toggles like reaction on a post', () => {
      const comm = devStore.getCommunity(campusId, user1.id, 'coding-ai');
      const posts = devStore.listCommunityPosts(comm.id, user1.id);
      const targetPost = posts[0]!;
      const initialLikes = targetPost.likesCount;

      // Like
      const like1 = devStore.toggleCommunityPostLike(user1.id, targetPost.id);
      expect(like1.hasLiked).toBe(true);
      expect(like1.likesCount).toBe(initialLikes + 1);

      // Unlike
      const like2 = devStore.toggleCommunityPostLike(user1.id, targetPost.id);
      expect(like2.hasLiked).toBe(false);
      expect(like2.likesCount).toBe(initialLikes);
    });

    it('creates and lists replies on a post', () => {
      const comm = devStore.getCommunity(campusId, user1.id, 'coding-ai');
      const posts = devStore.listCommunityPosts(comm.id, user1.id);
      const targetPost = posts[0]!;

      const reply = devStore.createCommunityPostReply(user2, targetPost.id, {
        content: 'I will bring snacks! See you at 7pm.',
      });
      expect(reply.content).toBe('I will bring snacks! See you at 7pm.');
      expect(reply.author.id).toBe(user2.id);

      const replies = devStore.listCommunityPostReplies(targetPost.id);
      expect(replies.some((r) => r.id === reply.id)).toBe(true);
    });
  });
});
