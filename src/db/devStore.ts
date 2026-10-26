import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CurrentUser } from '../modules/shared/eligibility.js';
import type { DiscoverCard } from '../modules/profiles/discover.js';
import type { PhotoView } from '../modules/photos/service.js';
import type { ConfessionView, ModerationConfessionView } from '../modules/confessions/service.js';
import type { FriendshipRequestView, ConnectionView } from '../modules/friendships/service.js';
import type { CommunitySummaryView, CommunityPostView, CommunityReplyView } from '../modules/communities/service.js';
import { AppError, notFound } from '../http/errors.js';
import { computeSharedInterests, generateMatchExplanation } from '../modules/profiles/recommendations.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.resolve(__dirname, '../../../uploads/.dev_store.json');


export function isDbUnavailable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; name?: string };
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  const code = e.code ?? '';
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === '28P01' || // invalid_password
    code === '3D000' || // database_does_not_exist
    e.name === 'AggregateError' ||
    msg.includes('econnrefused') ||
    msg.includes('connection terminated') ||
    msg.includes('connect econnrefused') ||
    msg.includes('password authentication failed') ||
    msg.includes('database "hush" does not exist') ||
    msg.includes('timeout')
  );
}

export function devToMe(user: CurrentUser, profile: DevProfile, photos: PhotoView[], isModerator = false) {
  return {
    id: user.id,
    nickname: profile.nickname,
    bio: profile.bio,
    graduationYear: profile.graduationYear ?? null,
    major: profile.major ?? null,
    campusArea: profile.campusArea ?? null,
    interests: profile.interests,
    avatarUrl: profile.avatarUrl,
    photos,
    discoverable: profile.discoverable,
    updatedAt: profile.updatedAt.toISOString(),
    campus: { id: user.campusId, name: user.campusName },
    account: {
      status: user.status,
      ageStatus: user.ageStatus,
      campusStatus: user.campusStatus,
      eligible: true,
      missing: [] as string[],
      isModerator,
    },
  };
}

export interface DevUser {
  id: string;
  authSubject: string;
  campusId: string;
  campusName: string;
  campusActive: boolean;
  campusConfig: { emailDomains?: string[]; requireVerifiedAge?: boolean };
  ageStatus: 'SELF_ATTESTED' | 'VERIFIED' | 'UNVERIFIED';
  campusStatus: 'VERIFIED' | 'UNVERIFIED';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
}

export interface DevProfile {
  userId: string;
  nickname: string;
  nicknameKey: string;
  bio: string;
  graduationYear?: string | null;
  major?: string | null;
  campusArea?: string | null;
  interests: string[];
  avatarUrl: string | null;
  discoverable: boolean;
  updatedAt: Date;
}

export interface DevPhoto {
  id: string;
  userId: string;
  storagePath: string;
  displayOrder: number;
  isPrimary: boolean;
  createdAt: Date;
}

export interface DevMatch {
  id: string;
  userA: string;
  userB: string;
  status: 'ACTIVE' | 'UNMATCHED';
  createdAt: Date;
}

export interface DevNotification {
  id: string;
  userId: string;
  type: string;
  matchId: string;
  createdAt: Date;
  readAt: Date | null;
}

export interface DevMessage {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: Date;
}

export interface DevReport {
  id: string;
  reporterId: string;
  targetId: string;
  reason: 'HARASSMENT' | 'SPAM' | 'FAKE_PROFILE' | 'INAPPROPRIATE_CONTENT' | 'UNDERAGE' | 'OTHER';
  details: string | null;
  status: 'OPEN' | 'REVIEWING' | 'ACTIONED' | 'DISMISSED';
  createdAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  resolutionNote: string | null;
}

export interface DevConfession {
  id: string;
  campusId: string;
  authorId: string;
  content: string;
  category: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REMOVED';
  likesCount: number;
  reportsCount: number;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewerId: string | null;
}

export interface DevConfessionReport {
  id: string;
  confessionId: string;
  reporterId: string;
  reason: string;
  details: string | null;
  createdAt: Date;
}

export interface DevFriendshipRequest {
  id: string;
  senderId: string;
  receiverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  createdAt: Date;
  updatedAt: Date;
}

export interface DevConnection {
  id: string;
  userA: string;
  userB: string;
  createdAt: Date;
}

export interface DevCommunity {
  id: string;
  campusId: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  category: string;
  memberCount: number;
  postCount: number;
  createdAt: Date;
}

export interface DevCommunityPost {
  id: string;
  communityId: string;
  campusId: string;
  authorId: string;
  title: string;
  content: string;
  likesCount: number;
  repliesCount: number;
  isPinned: boolean;
  createdAt: Date;
}

export interface DevCommunityPostReply {
  id: string;
  postId: string;
  authorId: string;
  content: string;
  createdAt: Date;
}

class InMemoryDevStore {
  private users = new Map<string, DevUser>();
  private authToUser = new Map<string, string>();
  private profiles = new Map<string, DevProfile>();
  private photos = new Map<string, DevPhoto[]>();
  private crushes = new Set<string>(); // "senderId:receiverId"
  private matches = new Map<string, DevMatch>();
  private notifications: DevNotification[] = [];
  private messages = new Map<string, DevMessage[]>();
  private blocks = new Set<string>(); // "blockerId:blockedId"
  private reports = new Map<string, DevReport>();
  private confessions = new Map<string, DevConfession>();
  private confessionLikes = new Set<string>(); // "confessionId:userId"
  private confessionReports = new Map<string, DevConfessionReport>();
  private friendRequests = new Map<string, DevFriendshipRequest>();
  private connections = new Map<string, DevConnection>();
  private communities = new Map<string, DevCommunity>();
  private communityMemberships = new Set<string>(); // "communityId:userId"
  private communityPosts = new Map<string, DevCommunityPost>();
  private communityPostLikes = new Set<string>(); // "postId:userId"
  private communityPostReplies = new Map<string, DevCommunityPostReply[]>();

  public onAutoReply?: (matchId: string, partnerId: string, message: { id: string; content: string; createdAt: Date }) => void;
  public onAutoReplyTyping?: (matchId: string, isTyping: boolean) => void;

  constructor() {
    this.seedDemoData();
    this.loadFromDisk();
  }

  private saveToDisk() {
    try {
      const data = {
        users: Array.from(this.users.entries()),
        authToUser: Array.from(this.authToUser.entries()),
        profiles: Array.from(this.profiles.entries()),
        photos: Array.from(this.photos.entries()),
        crushes: Array.from(this.crushes.values()),
        matches: Array.from(this.matches.entries()),
        notifications: this.notifications,
        messages: Array.from(this.messages.entries()),
        blocks: Array.from(this.blocks.values()),
        reports: Array.from(this.reports.entries()),
        confessions: Array.from(this.confessions.entries()),
        confessionLikes: Array.from(this.confessionLikes.values()),
        confessionReports: Array.from(this.confessionReports.entries()),
        friendRequests: Array.from(this.friendRequests.entries()),
        connections: Array.from(this.connections.entries()),
        communities: Array.from(this.communities.entries()),
        communityMemberships: Array.from(this.communityMemberships.values()),
        communityPosts: Array.from(this.communityPosts.entries()),
        communityPostLikes: Array.from(this.communityPostLikes.values()),
        communityPostReplies: Array.from(this.communityPostReplies.entries()),
      };
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // non-fatal in dev
    }
  }

  private loadFromDisk() {
    try {
      if (!fs.existsSync(CACHE_FILE)) return;
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.users)) {
        for (const [k, v] of data.users) this.users.set(k, v);
      }
      if (Array.isArray(data.authToUser)) {
        for (const [k, v] of data.authToUser) this.authToUser.set(k, v);
      }
      if (Array.isArray(data.profiles)) {
        for (const [k, v] of data.profiles) {
          const existing = this.profiles.get(k);
          this.profiles.set(k, {
            ...existing,
            ...v,
            major: v.major ?? existing?.major ?? null,
            graduationYear: v.graduationYear ?? existing?.graduationYear ?? null,
            campusArea: v.campusArea ?? existing?.campusArea ?? null,
            updatedAt: new Date(v.updatedAt),
          });
        }
      }
      if (Array.isArray(data.photos)) {
        for (const [k, v] of data.photos) {
          this.photos.set(
            k,
            v.map((p: any) => ({ ...p, createdAt: new Date(p.createdAt) })),
          );
        }
      }
      if (Array.isArray(data.crushes)) {
        for (const c of data.crushes) this.crushes.add(c);
      }
      if (Array.isArray(data.matches)) {
        for (const [k, v] of data.matches) {
          this.matches.set(k, { ...v, createdAt: new Date(v.createdAt) });
        }
      }
      if (Array.isArray(data.notifications)) {
        this.notifications = data.notifications.map((n: any) => ({
          ...n,
          createdAt: new Date(n.createdAt),
          readAt: n.readAt ? new Date(n.readAt) : null,
        }));
      }
      if (Array.isArray(data.messages)) {
        for (const [k, v] of data.messages) {
          this.messages.set(
            k,
            v.map((m: any) => ({ ...m, createdAt: new Date(m.createdAt) })),
          );
        }
      }
      if (Array.isArray(data.blocks)) {
        for (const b of data.blocks) this.blocks.add(b);
      }
      if (Array.isArray(data.reports)) {
        for (const [k, v] of data.reports) {
          this.reports.set(k, {
            ...v,
            createdAt: new Date(v.createdAt),
            reviewedAt: v.reviewedAt ? new Date(v.reviewedAt) : null,
          });
        }
      }
      if (Array.isArray(data.confessions)) {
        for (const [k, v] of data.confessions) {
          this.confessions.set(k, {
            ...v,
            createdAt: new Date(v.createdAt),
            reviewedAt: v.reviewedAt ? new Date(v.reviewedAt) : null,
          });
        }
      }
      if (Array.isArray(data.confessionLikes)) {
        for (const l of data.confessionLikes) this.confessionLikes.add(l);
      }
      if (Array.isArray(data.confessionReports)) {
        for (const [k, v] of data.confessionReports) {
          this.confessionReports.set(k, {
            ...v,
            createdAt: new Date(v.createdAt),
          });
        }
      }
      if (Array.isArray(data.friendRequests)) {
        for (const [k, v] of data.friendRequests) {
          this.friendRequests.set(k, {
            ...v,
            createdAt: new Date(v.createdAt),
            updatedAt: new Date(v.updatedAt),
          });
        }
      }
      if (Array.isArray(data.connections)) {
        for (const [k, v] of data.connections) {
          this.connections.set(k, {
            ...v,
            createdAt: new Date(v.createdAt),
          });
        }
      }
      if (Array.isArray(data.communities)) {
        for (const [k, v] of data.communities) {
          this.communities.set(k, {
            ...v,
            createdAt: new Date(v.createdAt),
          });
        }
      }
      if (Array.isArray(data.communityMemberships)) {
        for (const m of data.communityMemberships) this.communityMemberships.add(m);
      }
      if (Array.isArray(data.communityPosts)) {
        for (const [k, v] of data.communityPosts) {
          this.communityPosts.set(k, {
            ...v,
            createdAt: new Date(v.createdAt),
          });
        }
      }
      if (Array.isArray(data.communityPostLikes)) {
        for (const l of data.communityPostLikes) this.communityPostLikes.add(l);
      }
      if (Array.isArray(data.communityPostReplies)) {
        for (const [k, v] of data.communityPostReplies) {
          this.communityPostReplies.set(
            k,
            v.map((r: any) => ({ ...r, createdAt: new Date(r.createdAt) })),
          );
        }
      }

    } catch {
      // non-fatal in dev
    }
  }


  private seedDemoData() {
    const campusId = '11111111-1111-1111-1111-111111111111';
    const demoCandidates = [
      {
        id: '20000000-0000-0000-0000-000000000001',
        nickname: 'Maya Sharma',
        bio: 'CS sophomore obsessed with indie music, iced matcha, and late night debug sessions 🎧☕',
        graduationYear: "Sophomore (Class of '27)",
        major: 'Computer Science & AI',
        campusArea: 'North Dorms',
        interests: ['Pop', 'Anime', 'Coffee', 'Coding', 'Quiet dates'],
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
        photos: [
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
        ],
      },
      {
        id: '20000000-0000-0000-0000-000000000002',
        nickname: 'Jordan Lee',
        bio: 'Visual design student. Looking for museum buddies and people who can recommend good ambient playlists 🎨✨',
        graduationYear: "Junior (Class of '26)",
        major: 'Visual Design & Fine Arts',
        campusArea: 'South Campus',
        interests: ['Design', 'Photography', 'Art', 'Cafes', 'Indie'],
        avatarUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=800&q=80',
        photos: [
          'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
        ],
      },
      {
        id: '20000000-0000-0000-0000-000000000003',
        nickname: 'Priya Patel',
        bio: 'Lit major who will definitely judge your taste in thrillers. Big fan of street food and rainy days 📚🍜',
        graduationYear: "Senior (Class of '25)",
        major: 'Literature & Creative Writing',
        campusArea: 'East Wing Hostels',
        interests: ['Reading', 'Writing', 'Street food', 'Late-night talks', 'Deep conversations'],
        avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
        photos: [
          'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
        ],
      },
      {
        id: '20000000-0000-0000-0000-000000000004',
        nickname: 'Alex Chen',
        bio: 'Economics & tech. 60% gym, 30% startup podcasts, 10% trying to cook without burning the kitchen ⚡',
        graduationYear: "Sophomore (Class of '27)",
        major: 'Economics & Finance',
        campusArea: 'West Wing Hostels',
        interests: ['Gym', 'Startups', 'Hip-hop', 'Memes', 'Spontaneous plans'],
        avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
        photos: [
          'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
        ],
      },
      {
        id: '20000000-0000-0000-0000-000000000005',
        nickname: 'Sam Taylor',
        bio: 'Always at concerts or planning weekend trips. Tell me your top 3 songs of all time 🎵✈️',
        graduationYear: "Freshman (Class of '28)",
        major: 'Media & Communications',
        campusArea: 'Off-Campus Commuter',
        interests: ['Live concerts', 'Travelling', 'Fashion', 'Dancing', 'Extrovert'],
        avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
        photos: [
          'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
        ],
      },
    ];

    for (const c of demoCandidates) {
      this.users.set(c.id, {
        id: c.id,
        authSubject: `demo-sub-${c.id}`,
        campusId,
        campusName: 'Example University',
        campusActive: true,
        campusConfig: { emailDomains: ['example.edu', 'uni.edu'] },
        ageStatus: 'VERIFIED',
        campusStatus: 'VERIFIED',
        status: 'ACTIVE',
      });
      this.authToUser.set(`demo-sub-${c.id}`, c.id);

      this.profiles.set(c.id, {
        userId: c.id,
        nickname: c.nickname,
        nicknameKey: c.nickname.toLowerCase(),
        bio: c.bio,
        graduationYear: c.graduationYear,
        major: c.major,
        campusArea: c.campusArea,
        interests: c.interests,
        avatarUrl: c.avatarUrl,
        discoverable: true,
        updatedAt: new Date(),
      });

      const photoList: DevPhoto[] = c.photos.map((url, idx) => ({
        id: randomUUID(),
        userId: c.id,
        storagePath: url,
        displayOrder: idx,
        isPrimary: idx === 0,
        createdAt: new Date(),
      }));
      this.photos.set(c.id, photoList);
    }

    const sampleReports: DevReport[] = [
      {
        id: '30000000-0000-0000-0000-000000000001',
        reporterId: '20000000-0000-0000-0000-000000000001',
        targetId: '20000000-0000-0000-0000-000000000004',
        reason: 'SPAM',
        details: 'Sending unsolicited external Telegram crypto links in conversation.',
        status: 'OPEN',
        createdAt: new Date(Date.now() - 3600 * 1000 * 2),
        reviewedBy: null,
        reviewedAt: null,
        resolutionNote: null,
      },
      {
        id: '30000000-0000-0000-0000-000000000002',
        reporterId: '20000000-0000-0000-0000-000000000002',
        targetId: '20000000-0000-0000-0000-000000000005',
        reason: 'FAKE_PROFILE',
        details: 'Photos reverse image search to a fashion model profile on Pinterest.',
        status: 'REVIEWING',
        createdAt: new Date(Date.now() - 3600 * 1000 * 8),
        reviewedBy: 'mod-admin',
        reviewedAt: new Date(Date.now() - 3600 * 1000 * 4),
        resolutionNote: 'Checking student directory for enrollment confirmation.',
      },
      {
        id: '30000000-0000-0000-0000-000000000003',
        reporterId: '20000000-0000-0000-0000-000000000003',
        targetId: '20000000-0000-0000-0000-000000000002',
        reason: 'HARASSMENT',
        details: 'Disagreement in campus club chat.',
        status: 'DISMISSED',
        createdAt: new Date(Date.now() - 3600 * 1000 * 24),
        reviewedBy: 'mod-admin',
        reviewedAt: new Date(Date.now() - 3600 * 1000 * 12),
        resolutionNote: 'Reviewed context: No violation of Hush community guidelines detected.',
      },
    ];
    for (const r of sampleReports) {
      this.reports.set(r.id, r);
    }

    const sampleConfessions: DevConfession[] = [
      {
        id: '40000000-0000-0000-0000-000000000001',
        campusId,
        authorId: '20000000-0000-0000-0000-000000000001',
        content: 'To the person wearing the forest green oversized hoodie in the library 3rd floor quiet zone: your study playlist is immaculate and I was secretly grooving along ✨',
        category: 'Crushes',
        status: 'APPROVED',
        likesCount: 19,
        reportsCount: 0,
        createdAt: new Date(Date.now() - 3600 * 1000 * 3),
        reviewedAt: null,
        reviewerId: null,
      },
      {
        id: '40000000-0000-0000-0000-000000000002',
        campusId,
        authorId: '20000000-0000-0000-0000-000000000002',
        content: 'Petition to keep the central campus cafe open till 2 AM during midterms! That iced caramel latte is literally carrying my entire semester GPA ☕🙏',
        category: 'Campus Life',
        status: 'APPROVED',
        likesCount: 38,
        reportsCount: 0,
        createdAt: new Date(Date.now() - 3600 * 1000 * 7),
        reviewedAt: null,
        reviewerId: null,
      },
      {
        id: '40000000-0000-0000-0000-000000000003',
        campusId,
        authorId: '20000000-0000-0000-0000-000000000003',
        content: 'Overheard outside the quad: "Bro, if you like her just send a Hush crush, worst case she never knows, best case you\'re getting boba tomorrow." Words to live by 💖',
        category: 'Overheard',
        status: 'APPROVED',
        likesCount: 54,
        reportsCount: 0,
        createdAt: new Date(Date.now() - 3600 * 1000 * 14),
        reviewedAt: null,
        reviewerId: null,
      },
      {
        id: '40000000-0000-0000-0000-000000000004',
        campusId,
        authorId: '20000000-0000-0000-0000-000000000004',
        content: 'Looking for a study partner for tomorrow\'s Algorithms exam who appreciates lo-fi beats, snack breaks, and mutual motivation 💻⚡',
        category: 'Academics',
        status: 'APPROVED',
        likesCount: 12,
        reportsCount: 0,
        createdAt: new Date(Date.now() - 3600 * 1000 * 22),
        reviewedAt: null,
        reviewerId: null,
      },
    ];
    for (const c of sampleConfessions) {
      if (!this.confessions.has(c.id)) {
        this.confessions.set(c.id, c);
      }
    }

    const sampleCommunities: DevCommunity[] = [
      {
        id: '50000000-0000-0000-0000-000000000001',
        campusId,
        name: 'Coding & AI Lab',
        slug: 'coding-ai',
        description: 'From LeetCode grinding to training local LLMs, hackathons, and late-night debugging sprints 💻⚡',
        icon: '💻',
        category: 'Tech',
        memberCount: 42,
        postCount: 2,
        createdAt: new Date(Date.now() - 3600 * 1000 * 48),
      },
      {
        id: '50000000-0000-0000-0000-000000000002',
        campusId,
        name: 'Indie Beats & Vinyl',
        slug: 'indie-music',
        description: 'Lo-fi study tracks, campus band jams, concert carpools, and synth obsessions 🎧✨',
        icon: '🎧',
        category: 'Music',
        memberCount: 35,
        postCount: 1,
        createdAt: new Date(Date.now() - 3600 * 1000 * 40),
      },
      {
        id: '50000000-0000-0000-0000-000000000003',
        campusId,
        name: 'Midnight LAN & Gaming',
        slug: 'campus-gaming',
        description: 'Valorant, Smash, board game nights, and late-night campus dorm tournaments 🎮🔥',
        icon: '🎮',
        category: 'Gaming',
        memberCount: 29,
        postCount: 1,
        createdAt: new Date(Date.now() - 3600 * 1000 * 36),
      },
      {
        id: '50000000-0000-0000-0000-000000000004',
        campusId,
        name: 'Campus Fitness & Calisthenics',
        slug: 'fitness-calisthenics',
        description: 'Gym buddies, running clubs, PR celebrations, and dorm meal prep advice 🏋️💪',
        icon: '🏋️',
        category: 'Fitness',
        memberCount: 38,
        postCount: 1,
        createdAt: new Date(Date.now() - 3600 * 1000 * 30),
      },
      {
        id: '50000000-0000-0000-0000-000000000005',
        campusId,
        name: 'Founder Lab & Startups',
        slug: 'founder-lab',
        description: 'Pitch decks, side projects, finding co-founders, and turning dorm room ideas into reality 🚀💡',
        icon: '🚀',
        category: 'Entrepreneurship',
        memberCount: 27,
        postCount: 1,
        createdAt: new Date(Date.now() - 3600 * 1000 * 25),
      },
      {
        id: '50000000-0000-0000-0000-000000000006',
        campusId,
        name: 'Quiet Corner & Study Sprints',
        slug: 'study-sprints',
        description: 'Pomodoro sessions, library 4th floor meetups, and exam survival kits 📚☕',
        icon: '📚',
        category: 'Academics',
        memberCount: 45,
        postCount: 1,
        createdAt: new Date(Date.now() - 3600 * 1000 * 20),
      },
      {
        id: '50000000-0000-0000-0000-000000000007',
        campusId,
        name: 'Campus Life & Chai Spills',
        slug: 'campus-chai',
        description: 'Canteen recommendations, fest updates, roommate tips, and weekend hangouts ☕✨',
        icon: '☕',
        category: 'Social',
        memberCount: 61,
        postCount: 1,
        createdAt: new Date(Date.now() - 3600 * 1000 * 15),
      },
    ];

    for (const comm of sampleCommunities) {
      if (!this.communities.has(comm.id)) {
        this.communities.set(comm.id, comm);
      }
    }

    const samplePosts: DevCommunityPost[] = [
      {
        id: '60000000-0000-0000-0000-000000000001',
        communityId: '50000000-0000-0000-0000-000000000001',
        campusId,
        authorId: '20000000-0000-0000-0000-000000000001',
        title: 'Anyone down for the upcoming 36hr Campus Hackathon?',
        content: 'We need 1 frontend dev who knows React / Tailwind and 1 ML enthusiast for a student assistant agent project. Free pizza and caffeine included!',
        likesCount: 14,
        repliesCount: 2,
        isPinned: true,
        createdAt: new Date(Date.now() - 3600 * 1000 * 12),
      },
      {
        id: '60000000-0000-0000-0000-000000000002',
        communityId: '50000000-0000-0000-0000-000000000001',
        campusId,
        authorId: '20000000-0000-0000-0000-000000000004',
        title: 'Running Llama-3 locally on MacBook M-series — benchmark results',
        content: 'Sharing quantized 4-bit config benchmarks if anyone is doing thesis work without GPU cluster credits. Hit me up for the script!',
        likesCount: 22,
        repliesCount: 1,
        isPinned: false,
        createdAt: new Date(Date.now() - 3600 * 1000 * 5),
      },
      {
        id: '60000000-0000-0000-0000-000000000007',
        communityId: '50000000-0000-0000-0000-000000000007',
        campusId,
        authorId: '20000000-0000-0000-0000-000000000002',
        title: 'Best masala chai spot near North Dorms?',
        content: 'The canteen machine has been broken for 2 days. Who knows the secret stall behind the engineering auditorium?',
        likesCount: 31,
        repliesCount: 1,
        isPinned: false,
        createdAt: new Date(Date.now() - 3600 * 1000 * 8),
      },
    ];

    for (const p of samplePosts) {
      if (!this.communityPosts.has(p.id)) {
        this.communityPosts.set(p.id, p);
      }
    }

    const sampleReplies: DevCommunityPostReply[] = [
      {
        id: '70000000-0000-0000-0000-000000000001',
        postId: '60000000-0000-0000-0000-000000000001',
        authorId: '20000000-0000-0000-0000-000000000002',
        content: 'I can do UI/UX and Tailwind! Sent you a connection request 🚀',
        createdAt: new Date(Date.now() - 3600 * 1000 * 10),
      },
      {
        id: '70000000-0000-0000-0000-000000000002',
        postId: '60000000-0000-0000-0000-000000000001',
        authorId: '20000000-0000-0000-0000-000000000004',
        content: 'Count me in for ML/backend pipeline integration.',
        createdAt: new Date(Date.now() - 3600 * 1000 * 9),
      },
      {
        id: '70000000-0000-0000-0000-000000000003',
        postId: '60000000-0000-0000-0000-000000000007',
        authorId: '20000000-0000-0000-0000-000000000003',
        content: 'Raju Tapri behind Gate 3! Ask for ginger cardamom special ☕👌',
        createdAt: new Date(Date.now() - 3600 * 1000 * 6),
      },
    ];

    for (const rep of sampleReplies) {
      const list = this.communityPostReplies.get(rep.postId) ?? [];
      if (!list.some((r) => r.id === rep.id)) {
        list.push(rep);
        this.communityPostReplies.set(rep.postId, list);
      }
    }

    const sampleConnId = '80000000-0000-0000-0000-000000000001';
    if (!this.connections.has(sampleConnId)) {
      this.connections.set(sampleConnId, {
        id: sampleConnId,
        userA: '20000000-0000-0000-0000-000000000001',
        userB: '20000000-0000-0000-0000-000000000002',
        createdAt: new Date(Date.now() - 3600 * 1000 * 24),
      });
    }

    const sampleReqId = '90000000-0000-0000-0000-000000000001';
    if (!this.friendRequests.has(sampleReqId)) {
      this.friendRequests.set(sampleReqId, {
        id: sampleReqId,
        senderId: '20000000-0000-0000-0000-000000000003',
        receiverId: '20000000-0000-0000-0000-000000000001',
        status: 'PENDING',
        createdAt: new Date(Date.now() - 3600 * 1000 * 4),
        updatedAt: new Date(Date.now() - 3600 * 1000 * 4),
      });
    }
  }

  getUserByAuthSubject(authSubject: string): CurrentUser | null {
    const userId = this.authToUser.get(authSubject);
    if (!userId) return null;
    return this.getUserById(userId);
  }

  getUserById(userId: string): CurrentUser | null {
    const u = this.users.get(userId);
    if (!u) return null;
    return {
      id: u.id,
      authSubject: u.authSubject,
      campusId: u.campusId,
      campusName: u.campusName,
      campusActive: u.campusActive,
      campusConfig: u.campusConfig,
      ageStatus: u.ageStatus,
      campusStatus: u.campusStatus,
      status: u.status,
    };
  }

  saveProfile(
    authSubject: string,
    campusId: string,
    nickname: string,
    bio: string,
    interests: string[],
    avatarUrl: string | null,
    discoverable: boolean,
    uploadedPhotos: Array<{ storagePath: string; isPrimary: boolean }>,
  ): { user: CurrentUser; profile: DevProfile; photos: PhotoView[] } {
    let userId = this.authToUser.get(authSubject);
    if (!userId) {
      userId = randomUUID();
      this.authToUser.set(authSubject, userId);
      this.users.set(userId, {
        id: userId,
        authSubject,
        campusId: campusId || '11111111-1111-1111-1111-111111111111',
        campusName: 'Example University',
        campusActive: true,
        campusConfig: { emailDomains: ['example.edu', 'uni.edu'] },
        ageStatus: 'SELF_ATTESTED',
        campusStatus: 'VERIFIED',
        status: 'ACTIVE',
      });
    }

    const devPhotos: DevPhoto[] = uploadedPhotos.map((p, idx) => ({
      id: randomUUID(),
      userId: userId!,
      storagePath: p.storagePath,
      displayOrder: idx,
      isPrimary: p.isPrimary,
      createdAt: new Date(),
    }));
    this.photos.set(userId, devPhotos);

    let finalAvatarUrl = avatarUrl;
    const primary = devPhotos.find((p) => p.isPrimary) ?? devPhotos[0];
    if (primary) {
      finalAvatarUrl = `/api/v1/profiles/photos/${primary.id}`;
    }

    const devProfile: DevProfile = {
      userId,
      nickname,
      nicknameKey: nickname.toLowerCase(),
      bio,
      interests,
      avatarUrl: finalAvatarUrl,
      discoverable,
      updatedAt: new Date(),
    };
    this.profiles.set(userId, devProfile);

    // Ensure new dev user has an active match with Maya Sharma so Chat is immediately testable
    const hasAnyMatch = Array.from(this.matches.values()).some(
      (m) => m.status === 'ACTIVE' && (m.userA === userId || m.userB === userId),
    );
    if (!hasAnyMatch) {
      const demoCandidateId = '20000000-0000-0000-0000-000000000001'; // Maya Sharma
      const starterMatchId = randomUUID();
      const userA = userId! < demoCandidateId ? userId! : demoCandidateId;
      const userB = userId! < demoCandidateId ? demoCandidateId : userId!;
      this.matches.set(starterMatchId, {
        id: starterMatchId,
        userA,
        userB,
        status: 'ACTIVE',
        createdAt: new Date(),
      });
      this.crushes.add(`${userId}:${demoCandidateId}`);
      this.crushes.add(`${demoCandidateId}:${userId}`);
      this.messages.set(starterMatchId, [
        {
          id: randomUUID(),
          matchId: starterMatchId,
          senderId: demoCandidateId,
          content: `Hey! ✨ So glad we matched on Hush! What campus coffee spot do you swear by? ☕`,
          createdAt: new Date(),
        },
      ]);
    }

    const user = this.getUserById(userId)!;
    const photoViews: PhotoView[] = devPhotos.map((p) => ({
      id: p.id,
      url: `/api/v1/profiles/photos/${p.id}`,
      displayOrder: p.displayOrder,
      isPrimary: p.isPrimary,
      createdAt: p.createdAt,
    }));

    this.saveToDisk();
    return { user, profile: devProfile, photos: photoViews };
  }




  getProfile(userId: string): DevProfile | null {
    return this.profiles.get(userId) ?? null;
  }

  getPhotos(userId: string): PhotoView[] {
    const list = this.photos.get(userId) ?? [];
    return list
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((p) => ({
        id: p.id,
        url: p.storagePath.startsWith('http') ? p.storagePath : `/api/v1/profiles/photos/${p.id}`,
        displayOrder: p.displayOrder,
        isPrimary: p.isPrimary,
        createdAt: p.createdAt,
      }));
  }

  getPhotoRecord(photoId: string): DevPhoto | null {
    for (const list of this.photos.values()) {
      const found = list.find((p) => p.id === photoId);
      if (found) return found;
    }
    return null;
  }

  addPhoto(userId: string, storagePath: string, isPrimary = false): PhotoView[] {
    const list = this.photos.get(userId) ?? [];
    if (list.length >= 6) throw new Error('Maximum 6 photos allowed');
    const primary = isPrimary || list.length === 0;
    if (primary) {
      for (const p of list) p.isPrimary = false;
    }
    const newPhoto: DevPhoto = {
      id: randomUUID(),
      userId,
      storagePath,
      displayOrder: list.length,
      isPrimary: primary,
      createdAt: new Date(),
    };
    list.push(newPhoto);
    this.photos.set(userId, list);

    if (primary) {
      const prof = this.profiles.get(userId);
      if (prof) {
        prof.avatarUrl = `/api/v1/profiles/photos/${newPhoto.id}`;
      }
    }
    this.saveToDisk();
    return this.getPhotos(userId);
  }

  reorderPhotos(userId: string, photoIds: string[]): PhotoView[] {
    const list = this.photos.get(userId) ?? [];
    const map = new Map(list.map((p) => [p.id, p]));
    const next: DevPhoto[] = [];
    photoIds.forEach((id, idx) => {
      const p = map.get(id);
      if (p) {
        p.displayOrder = idx;
        next.push(p);
      }
    });
    this.photos.set(userId, next);
    this.saveToDisk();
    return this.getPhotos(userId);
  }

  setPrimaryPhoto(userId: string, photoId: string): PhotoView[] {
    const list = this.photos.get(userId) ?? [];
    for (const p of list) {
      p.isPrimary = p.id === photoId;
    }
    const prof = this.profiles.get(userId);
    if (prof) {
      prof.avatarUrl = `/api/v1/profiles/photos/${photoId}`;
    }
    this.saveToDisk();
    return this.getPhotos(userId);
  }


  deletePhoto(userId: string, photoId: string): PhotoView[] {
    let list = this.photos.get(userId) ?? [];
    const deleting = list.find((p) => p.id === photoId);
    list = list.filter((p) => p.id !== photoId);
    list.forEach((p, idx) => {
      p.displayOrder = idx;
    });
    if (deleting?.isPrimary && list.length > 0 && list[0]) {
      list[0].isPrimary = true;
      const prof = this.profiles.get(userId);
      if (prof) {
        prof.avatarUrl = `/api/v1/profiles/photos/${list[0].id}`;
      }
    }
    this.photos.set(userId, list);
    this.saveToDisk();
    return this.getPhotos(userId);
  }

  updateInterests(userId: string, interestNames: string[]) {
    const prof = this.profiles.get(userId);
    if (prof) {
      prof.interests = interestNames;
      prof.updatedAt = new Date();
      this.saveToDisk();
    }
  }

  updateProfile(userId: string, patch: Partial<DevProfile>): DevProfile {
    const prof = this.profiles.get(userId);
    if (!prof) throw new Error('Profile not found');
    Object.assign(prof, patch, { updatedAt: new Date() });
    this.saveToDisk();
    return prof;
  }


  getDiscoverCards(viewer: CurrentUser, limit: number): { cards: DiscoverCard[]; nextCursor: string | null } {
    const viewerProfile = this.profiles.get(viewer.id);
    const viewerInterests = viewerProfile?.interests ?? [];

    const candidates: Array<{ card: DiscoverCard; sharedCount: number }> = [];
    for (const [userId, prof] of this.profiles.entries()) {
      if (userId === viewer.id) continue;
      if (!prof.discoverable) continue;

      // Exclude blocked relationships in either direction
      if (this.blocks.has(`${viewer.id}:${userId}`) || this.blocks.has(`${userId}:${viewer.id}`)) {
        continue;
      }

      // Check if user is suspended or deleted
      const u = this.users.get(userId);
      if (u && (u.status === 'SUSPENDED' || u.status === 'DELETED')) {
        continue;
      }

      // Check if matched
      const matched = Array.from(this.matches.values()).some(
        (m) =>
          m.status === 'ACTIVE' &&
          ((m.userA === viewer.id && m.userB === userId) || (m.userA === userId && m.userB === viewer.id)),
      );
      if (matched) continue;

      const crushed = this.crushes.has(`${viewer.id}:${userId}`);
      const userPhotos = this.getPhotos(userId);
      const featuredUrl = userPhotos.find((p) => p.isPrimary)?.url ?? userPhotos[0]?.url ?? prof.avatarUrl;

      const shared = computeSharedInterests(viewerInterests, prof.interests);
      const matchReason = generateMatchExplanation(shared, viewer.campusName);

      candidates.push({
        card: {
          id: userId,
          nickname: prof.nickname,
          bio: prof.bio,
          graduationYear: prof.graduationYear ?? null,
          major: prof.major ?? null,
          campusArea: prof.campusArea ?? null,
          interests: prof.interests,
          avatarUrl: featuredUrl,
          crushed,
          matchReason,
          sharedInterests: shared,
        },
        sharedCount: shared.length,
      });
    }

    // Rank by shared interests count descending
    candidates.sort((a, b) => b.sharedCount - a.sharedCount);

    const page = candidates.slice(0, limit).map((c) => c.card);
    return { cards: page, nextCursor: null };
  }

  sendCrush(sender: CurrentUser, receiverId: string): { matched: boolean; matchId?: string } {
    this.crushes.add(`${sender.id}:${receiverId}`);
    // Check for mutual interest! For demo delight, if you crush on Maya or Jordan, they crush back!
    const isMutual = this.crushes.has(`${receiverId}:${sender.id}`) || receiverId.startsWith('20000000-0000-0000');
    if (isMutual) {
      // Establish mutual crush
      this.crushes.add(`${receiverId}:${sender.id}`);
      const userA = sender.id < receiverId ? sender.id : receiverId;
      const userB = sender.id < receiverId ? receiverId : sender.id;
      const matchId = randomUUID();
      this.matches.set(matchId, {
        id: matchId,
        userA,
        userB,
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      // Queue notification for celebration!
      this.notifications.push({
        id: randomUUID(),
        userId: sender.id,
        type: 'NEW_MATCH',
        matchId,
        createdAt: new Date(),
        readAt: null,
      });
      this.saveToDisk();
      return { matched: true, matchId };
    }
    this.saveToDisk();
    return { matched: false };
  }


  getMatches(viewer: CurrentUser) {
    const list: any[] = [];
    for (const m of this.matches.values()) {
      if (m.status !== 'ACTIVE') continue;
      if (m.userA !== viewer.id && m.userB !== viewer.id) continue;
      const partnerId = m.userA === viewer.id ? m.userB : m.userA;
      if (this.blocks.has(`${viewer.id}:${partnerId}`) || this.blocks.has(`${partnerId}:${viewer.id}`)) {
        continue;
      }
      const partnerProfile = this.profiles.get(partnerId);
      const partnerUser = this.users.get(partnerId);
      const partnerPhotos = this.getPhotos(partnerId);
      const partnerAvatar = partnerPhotos.find((p) => p.isPrimary)?.url ?? partnerProfile?.avatarUrl ?? null;

      const msgs = this.messages.get(m.id) ?? [];
      const last = msgs[msgs.length - 1];
      const lastMessage = last
        ? {
            preview: last.content.slice(0, 80),
            createdAt: last.createdAt.toISOString(),
            mine: last.senderId === viewer.id,
          }
        : null;

      list.push({
        id: m.id,
        createdAt: m.createdAt.toISOString(),
        partner: {
          id: partnerId,
          nickname: partnerProfile?.nickname ?? 'Secret Match',
          avatarUrl: partnerAvatar,
          photos: partnerPhotos,
          campusName: partnerUser?.campusName ?? 'Campus',
          interests: partnerProfile?.interests ?? [],
          bio: partnerProfile?.bio ?? '',
        },
        lastMessage,
      });
    }
    return list;
  }

  getMatch(viewer: CurrentUser, matchId: string) {
    const m = this.matches.get(matchId);
    if (!m || m.status !== 'ACTIVE') return null;
    if (m.userA !== viewer.id && m.userB !== viewer.id) return null;

    const partnerId = m.userA === viewer.id ? m.userB : m.userA;
    if (this.blocks.has(`${viewer.id}:${partnerId}`) || this.blocks.has(`${partnerId}:${viewer.id}`)) {
      return null;
    }

    const partnerProfile = this.profiles.get(partnerId);
    const partnerUser = this.users.get(partnerId);
    const partnerPhotos = this.getPhotos(partnerId);
    const partnerAvatar = partnerPhotos.find((p) => p.isPrimary)?.url ?? partnerProfile?.avatarUrl ?? null;

    const msgs = this.messages.get(m.id) ?? [];
    const last = msgs[msgs.length - 1];
    const lastMessage = last
      ? {
          preview: last.content.slice(0, 80),
          createdAt: last.createdAt.toISOString(),
          mine: last.senderId === viewer.id,
        }
      : null;

    return {
      id: m.id,
      createdAt: m.createdAt.toISOString(),
      partner: {
        id: partnerId,
        nickname: partnerProfile?.nickname ?? 'Secret Match',
        avatarUrl: partnerAvatar,
        photos: partnerPhotos,
        campusName: partnerUser?.campusName ?? 'Campus',
        interests: partnerProfile?.interests ?? [],
        bio: partnerProfile?.bio ?? '',
      },
      lastMessage,
    };
  }

  unmatch(viewer: CurrentUser, matchId: string) {
    const m = this.matches.get(matchId);
    if (!m) return;
    if (m.userA === viewer.id || m.userB === viewer.id) {
      m.status = 'UNMATCHED';
      this.saveToDisk();
    }
  }

  getMessages(
    viewer: CurrentUser,
    matchId: string,
    q: { limit?: number; before?: string; after?: string } = {},
  ): { messages: Array<{ id: string; content: string; createdAt: string; mine: boolean }>; nextCursor: string | null } {
    const m = this.matches.get(matchId);
    if (!m || m.status !== 'ACTIVE') throw notFound('Match not found');
    if (m.userA !== viewer.id && m.userB !== viewer.id) throw notFound('Match not found');

    const partnerId = m.userA === viewer.id ? m.userB : m.userA;
    if (this.blocks.has(`${viewer.id}:${partnerId}`) || this.blocks.has(`${partnerId}:${viewer.id}`)) {
      throw notFound('Match not found');
    }

    const all = (this.messages.get(matchId) ?? []).slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let filtered = all;

    if (q.after) {
      const idx = all.findIndex((msg) => msg.id === q.after);
      if (idx !== -1) {
        filtered = all.slice(idx + 1);
      }
    } else if (q.before) {
      const idx = all.findIndex((msg) => msg.id === q.before);
      if (idx !== -1) {
        filtered = all.slice(0, idx);
      }
    }

    const limit = q.limit ?? 50;
    const page = filtered.slice(Math.max(0, filtered.length - limit));
    const nextCursor = filtered.length > limit && page[0] ? page[0].id : null;

    return {
      messages: page.map((msg) => ({
        id: msg.id,
        content: msg.content,
        createdAt: msg.createdAt.toISOString(),
        mine: msg.senderId === viewer.id,
      })),
      nextCursor,
    };
  }

  sendMessage(
    sender: CurrentUser,
    matchId: string,
    content: string,
  ): { id: string; content: string; createdAt: string; mine: boolean } {
    const m = this.matches.get(matchId);
    if (!m || m.status !== 'ACTIVE') throw notFound('Match not found');
    if (m.userA !== sender.id && m.userB !== sender.id) throw notFound('Match not found');

    const partnerId = m.userA === sender.id ? m.userB : m.userA;
    if (this.blocks.has(`${sender.id}:${partnerId}`) || this.blocks.has(`${partnerId}:${sender.id}`)) {
      throw notFound('Match not found');
    }

    const msg: DevMessage = {
      id: randomUUID(),
      matchId,
      senderId: sender.id,
      content,
      createdAt: new Date(),
    };

    const currentMsgs = this.messages.get(matchId) ?? [];
    currentMsgs.push(msg);
    this.messages.set(matchId, currentMsgs);
    this.saveToDisk();

    // Auto-reply simulation from demo college student with live typing & real-time delivery
    if (partnerId.startsWith('20000000-0000-0000')) {
      const typingTimer = setTimeout(() => {
        this.onAutoReplyTyping?.(matchId, true);
      }, 500);
      if (typeof typingTimer.unref === 'function') typingTimer.unref();

      const timer = setTimeout(() => {
        this.onAutoReplyTyping?.(matchId, false);
        const replies = [
          `Hey! So great chatting with you ✨ How's your week going?`,
          `Haha totally! Are you usually studying in the library or grabbing coffee? ☕`,
          `Indie playlists and iced matcha are keeping me alive this semester 🎧`,
          `We should totally grab a coffee or study on campus sometime! 🌸`,
          `Loved your bio and photos by the way! 🙌`,
        ];
        const randomReply = replies[Math.floor(Math.random() * replies.length)]!;
        const replyMsg: DevMessage = {
          id: randomUUID(),
          matchId,
          senderId: partnerId,
          content: randomReply,
          createdAt: new Date(),
        };
        const msgsNow = this.messages.get(matchId) ?? [];
        msgsNow.push(replyMsg);
        this.messages.set(matchId, msgsNow);

        // Queue notification
        this.notifications.push({
          id: randomUUID(),
          userId: sender.id,
          type: 'MESSAGE',
          matchId,
          createdAt: new Date(),
          readAt: null,
        });

        this.saveToDisk();
        this.onAutoReply?.(matchId, partnerId, replyMsg);
      }, 2000);
      if (typeof timer.unref === 'function') timer.unref();
    }


    return {
      id: msg.id,
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      mine: true,
    };
  }

  withdrawCrush(viewer: CurrentUser, targetUserId: string) {
    this.crushes.delete(`${viewer.id}:${targetUserId}`);
    this.saveToDisk();
  }

  deleteAccount(userId: string) {
    this.users.delete(userId);
    for (const [authSub, uid] of this.authToUser.entries()) {
      if (uid === userId) this.authToUser.delete(authSub);
    }
    this.profiles.delete(userId);
    this.photos.delete(userId);
    for (const c of Array.from(this.crushes)) {
      if (c.startsWith(`${userId}:`) || c.endsWith(`:${userId}`)) {
        this.crushes.delete(c);
      }
    }
    for (const m of this.matches.values()) {
      if (m.userA === userId || m.userB === userId) {
        m.status = 'UNMATCHED';
      }
    }
    this.notifications = this.notifications.filter((n) => n.userId !== userId);
    this.saveToDisk();
  }

  blockUser(viewer: CurrentUser, targetUserId: string) {
    this.blocks.add(`${viewer.id}:${targetUserId}`);
    for (const m of this.matches.values()) {
      if ((m.userA === viewer.id && m.userB === targetUserId) || (m.userA === targetUserId && m.userB === viewer.id)) {
        m.status = 'UNMATCHED';
      }
    }
    this.saveToDisk();
  }

  unblockUser(viewer: CurrentUser, targetUserId: string) {
    this.blocks.delete(`${viewer.id}:${targetUserId}`);
    this.saveToDisk();
  }

  listBlocked(viewer: CurrentUser): Array<{ id: string; nickname: string; blockedAt: string }> {
    const list: Array<{ id: string; nickname: string; blockedAt: string }> = [];
    for (const b of this.blocks) {
      const [blocker, blocked] = b.split(':');
      if (blocker === viewer.id && blocked) {
        const prof = this.profiles.get(blocked);
        list.push({
          id: blocked,
          nickname: prof?.nickname ?? 'Blocked user',
          blockedAt: new Date().toISOString(),
        });
      }
    }
    return list;
  }


  getNotifications(userId: string) {
    return this.notifications
      .filter((n) => n.userId === userId)
      .slice(-50)
      .reverse()
      .map((n) => ({
        id: n.id,
        type: n.type,
        matchId: n.matchId,
        createdAt: n.createdAt,
        readAt: n.readAt,
      }));
  }

  getUnreadNotificationsCount(userId: string): number {
    return this.notifications.filter((n) => n.userId === userId && n.readAt === null).length;
  }

  markNotificationRead(userId: string, notificationId: string) {
    const n = this.notifications.find((item) => item.id === notificationId && item.userId === userId);
    if (n && n.readAt === null) {
      n.readAt = new Date();
      this.saveToDisk();
    }
  }

  markNotificationsRead(userId: string) {
    let count = 0;
    for (const n of this.notifications) {
      if (n.userId === userId && n.readAt === null) {
        n.readAt = new Date();
        count++;
      }
    }
    if (count > 0) this.saveToDisk();
    return count;
  }

  fileReport(reporterId: string, input: { targetId: string; reason: any; details?: string }) {
    const existing = Array.from(this.reports.values()).find(
      (r) => r.reporterId === reporterId && r.targetId === input.targetId && (r.status === 'OPEN' || r.status === 'REVIEWING'),
    );
    if (existing) return;
    const id = randomUUID();
    this.reports.set(id, {
      id,
      reporterId,
      targetId: input.targetId,
      reason: input.reason,
      details: input.details ?? null,
      status: 'OPEN',
      createdAt: new Date(),
      reviewedBy: null,
      reviewedAt: null,
      resolutionNote: null,
    });
    this.saveToDisk();
  }

  listReports(q: { status?: string; reason?: string; order?: 'asc' | 'desc'; limit: number; offset: number }) {
    let list = Array.from(this.reports.values());
    if (q.status) {
      list = list.filter((r) => r.status === q.status);
    }
    if (q.reason) {
      list = list.filter((r) => r.reason === q.reason);
    }
    list.sort((a, b) => {
      const diff = a.createdAt.getTime() - b.createdAt.getTime();
      return q.order === 'asc' ? diff : -diff;
    });

    const paged = list.slice(q.offset, q.offset + q.limit);
    return paged.map((r) => {
      const reporterProfile = this.profiles.get(r.reporterId);
      const targetProfile = this.profiles.get(r.targetId);
      const targetUser = this.users.get(r.targetId);
      return {
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
        reporter: { id: r.reporterId, nickname: reporterProfile?.nickname ?? null },
        target: {
          id: r.targetId,
          nickname: targetProfile?.nickname ?? null,
          accountStatus: targetUser?.status ?? 'ACTIVE',
        },
        reviewedAt: r.reviewedAt,
        resolutionNote: r.resolutionNote,
      };
    });
  }

  reviewReport(reportId: string, moderatorSubject: string, input: { status: 'REVIEWING' | 'ACTIONED' | 'DISMISSED'; note?: string }) {
    const rep = this.reports.get(reportId);
    if (!rep) throw notFound('Report not found');
    rep.status = input.status;
    rep.reviewedBy = moderatorSubject;
    rep.reviewedAt = new Date();
    rep.resolutionNote = input.note ?? null;
    this.saveToDisk();
  }

  moderateUser(userId: string, action: 'suspend' | 'reinstate' | 'verify-age') {
    const u = this.users.get(userId);
    if (!u || u.status === 'DELETED') throw notFound('User not found');
    if (action === 'suspend') {
      u.status = 'SUSPENDED';
    } else if (action === 'reinstate') {
      u.status = 'ACTIVE';
    } else if (action === 'verify-age') {
      u.ageStatus = 'VERIFIED';
    }
    this.saveToDisk();
  }

  getCampusConfessions(campusId: string, currentUserId: string, category?: string, limit = 30): ConfessionView[] {
    let list = Array.from(this.confessions.values()).filter(
      (c) => c.campusId === campusId && c.status === 'APPROVED',
    );
    if (category && category !== 'All') {
      list = list.filter((c) => c.category === category);
    }
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return list.slice(0, limit).map((c) => ({
      id: c.id,
      campusId: c.campusId,
      content: c.content,
      category: c.category,
      likesCount: c.likesCount,
      hasLiked: this.confessionLikes.has(`${c.id}:${currentUserId}`),
      createdAt: c.createdAt.toISOString(),
    }));
  }

  createConfession(
    campusId: string,
    authorId: string,
    content: string,
    category: string,
    status: 'PENDING' | 'APPROVED' = 'APPROVED',
  ): ConfessionView {
    const id = randomUUID();
    const conf: DevConfession = {
      id,
      campusId,
      authorId,
      content,
      category,
      status,
      likesCount: 0,
      reportsCount: 0,
      createdAt: new Date(),
      reviewedAt: null,
      reviewerId: null,
    };
    this.confessions.set(id, conf);
    this.saveToDisk();
    return {
      id,
      campusId,
      content,
      category,
      likesCount: 0,
      hasLiked: false,
      createdAt: conf.createdAt.toISOString(),
    };
  }

  toggleConfessionLike(confessionId: string, userId: string): { liked: boolean; likesCount: number } {
    const conf = this.confessions.get(confessionId);
    if (!conf) throw notFound('Confession not found');
    const key = `${confessionId}:${userId}`;
    let liked = false;
    if (this.confessionLikes.has(key)) {
      this.confessionLikes.delete(key);
      conf.likesCount = Math.max(0, conf.likesCount - 1);
      liked = false;
    } else {
      this.confessionLikes.add(key);
      conf.likesCount += 1;
      liked = true;
    }
    this.saveToDisk();
    return { liked, likesCount: conf.likesCount };
  }

  reportConfession(confessionId: string, reporterId: string, reason: string, details?: string): { success: boolean } {
    const conf = this.confessions.get(confessionId);
    if (!conf) throw notFound('Confession not found');
    const repId = randomUUID();
    this.confessionReports.set(repId, {
      id: repId,
      confessionId,
      reporterId,
      reason,
      details: details ?? null,
      createdAt: new Date(),
    });
    conf.reportsCount += 1;
    if (conf.reportsCount >= 3) {
      conf.status = 'PENDING';
    }
    this.saveToDisk();
    return { success: true };
  }

  getModerationConfessions(statusFilter?: string): ModerationConfessionView[] {
    let list = Array.from(this.confessions.values());
    if (statusFilter && statusFilter !== 'ALL') {
      list = list.filter((c) => c.status === statusFilter);
    }
    list.sort((a, b) => b.reportsCount - a.reportsCount || b.createdAt.getTime() - a.createdAt.getTime());
    return list.slice(0, 50).map((c) => ({
      id: c.id,
      campusId: c.campusId,
      content: c.content,
      category: c.category,
      status: c.status,
      likesCount: c.likesCount,
      reportsCount: c.reportsCount,
      hasLiked: false,
      createdAt: c.createdAt.toISOString(),
      reviewedAt: c.reviewedAt ? c.reviewedAt.toISOString() : null,
    }));
  }

  moderateConfession(confessionId: string, action: 'APPROVE' | 'REJECT' | 'REMOVE', reviewerId?: string): { success: boolean } {
    const conf = this.confessions.get(confessionId);
    if (!conf) throw notFound('Confession not found');
    const statusMap = {
      APPROVE: 'APPROVED',
      REJECT: 'REJECTED',
      REMOVE: 'REMOVED',
    } as const;
    conf.status = statusMap[action];
    conf.reviewedAt = new Date();
    conf.reviewerId = reviewerId ?? null;
    this.saveToDisk();
    return { success: true };
  }

  // --- Friendships & Connections ---

  sendFriendRequest(sender: CurrentUser, receiverId: string): { status: 'sent' | 'already_connected' | 'already_requested' } {
    if (sender.id === receiverId) {
      throw new AppError(400, 'CANNOT_REQUEST_SELF', 'Cannot send friend request to yourself');
    }
    const receiver = this.users.get(receiverId);
    if (!receiver || receiver.campusId !== sender.campusId || receiver.status !== 'ACTIVE') {
      throw notFound('Student not found');
    }
    if (this.blocks.has(`${sender.id}:${receiverId}`) || this.blocks.has(`${receiverId}:${sender.id}`)) {
      throw notFound('Student not found');
    }

    const [uA, uB] = sender.id < receiverId ? [sender.id, receiverId] : [receiverId, sender.id];
    // Check if already connected
    for (const conn of this.connections.values()) {
      if (conn.userA === uA && conn.userB === uB) {
        return { status: 'already_connected' };
      }
    }

    // Check reciprocal request
    for (const req of this.friendRequests.values()) {
      if (req.senderId === receiverId && req.receiverId === sender.id && req.status === 'PENDING') {
        req.status = 'ACCEPTED';
        req.updatedAt = new Date();
        const connId = randomUUID();
        this.connections.set(connId, {
          id: connId,
          userA: uA,
          userB: uB,
          createdAt: new Date(),
        });
        this.saveToDisk();
        return { status: 'already_connected' };
      }
    }

    // Check existing request from sender
    for (const req of this.friendRequests.values()) {
      if (req.senderId === sender.id && req.receiverId === receiverId) {
        req.status = 'PENDING';
        req.updatedAt = new Date();
        this.saveToDisk();
        return { status: 'sent' };
      }
    }

    const newReqId = randomUUID();
    this.friendRequests.set(newReqId, {
      id: newReqId,
      senderId: sender.id,
      receiverId,
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.saveToDisk();
    return { status: 'sent' };
  }

  listFriendRequests(userId: string): FriendshipRequestView[] {
    const list: FriendshipRequestView[] = [];
    for (const req of this.friendRequests.values()) {
      if (req.receiverId === userId && req.status === 'PENDING') {
        const senderProfile = this.profiles.get(req.senderId);
        list.push({
          id: req.id,
          sender: {
            id: req.senderId,
            nickname: senderProfile?.nickname ?? 'Student',
            avatarUrl: senderProfile?.avatarUrl ?? null,
            major: senderProfile?.major ?? null,
            graduationYear: senderProfile?.graduationYear ?? null,
          },
          createdAt: req.createdAt.toISOString(),
        });
      }
    }
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }

  respondFriendRequest(userId: string, requestId: string, action: 'ACCEPT' | 'DECLINE'): { status: 'ACCEPTED' | 'DECLINED' } {
    const req = this.friendRequests.get(requestId);
    if (!req || req.receiverId !== userId || req.status !== 'PENDING') {
      throw notFound('Friend request not found');
    }

    if (action === 'DECLINE') {
      req.status = 'DECLINED';
      req.updatedAt = new Date();
      this.saveToDisk();
      return { status: 'DECLINED' };
    }

    req.status = 'ACCEPTED';
    req.updatedAt = new Date();
    const [uA, uB] = req.senderId < userId ? [req.senderId, userId] : [userId, req.senderId];
    const connId = randomUUID();
    this.connections.set(connId, {
      id: connId,
      userA: uA,
      userB: uB,
      createdAt: new Date(),
    });
    this.saveToDisk();
    return { status: 'ACCEPTED' };
  }

  listConnections(userId: string): ConnectionView[] {
    const list: ConnectionView[] = [];
    for (const conn of this.connections.values()) {
      if (conn.userA === userId || conn.userB === userId) {
        const partnerId = conn.userA === userId ? conn.userB : conn.userA;
        const profile = this.profiles.get(partnerId);
        list.push({
          id: conn.id,
          partner: {
            id: partnerId,
            nickname: profile?.nickname ?? 'Student',
            avatarUrl: profile?.avatarUrl ?? null,
            bio: profile?.bio ?? '',
            major: profile?.major ?? null,
            graduationYear: profile?.graduationYear ?? null,
            campusArea: profile?.campusArea ?? null,
            interests: profile?.interests ?? [],
          },
          createdAt: conn.createdAt.toISOString(),
        });
      }
    }
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }

  removeConnection(userId: string, partnerId: string): { success: boolean } {
    const [uA, uB] = userId < partnerId ? [userId, partnerId] : [partnerId, userId];
    for (const [id, conn] of this.connections.entries()) {
      if (conn.userA === uA && conn.userB === uB) {
        this.connections.delete(id);
        break;
      }
    }
    this.saveToDisk();
    return { success: true };
  }

  // --- Campus Communities ---

  listCommunities(campusId: string, userId: string, category?: string): CommunitySummaryView[] {
    let list = Array.from(this.communities.values()).filter((c) => c.campusId === campusId);
    if (category && category !== 'All') {
      list = list.filter((c) => c.category === category);
    }
    list.sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name));
    return list.map((c) => ({
      id: c.id,
      campusId: c.campusId,
      name: c.name,
      slug: c.slug,
      description: c.description,
      icon: c.icon,
      category: c.category,
      memberCount: c.memberCount,
      postCount: c.postCount,
      isMember: this.communityMemberships.has(`${c.id}:${userId}`),
      createdAt: c.createdAt.toISOString(),
    }));
  }

  getCommunity(campusId: string, userId: string, idOrSlug: string): CommunitySummaryView {
    const c = Array.from(this.communities.values()).find(
      (item) => item.campusId === campusId && (item.id === idOrSlug || item.slug === idOrSlug),
    );
    if (!c) throw notFound('Community not found');
    return {
      id: c.id,
      campusId: c.campusId,
      name: c.name,
      slug: c.slug,
      description: c.description,
      icon: c.icon,
      category: c.category,
      memberCount: c.memberCount,
      postCount: c.postCount,
      isMember: this.communityMemberships.has(`${c.id}:${userId}`),
      createdAt: c.createdAt.toISOString(),
    };
  }

  joinCommunity(userId: string, communityId: string): { joined: boolean } {
    const key = `${communityId}:${userId}`;
    if (!this.communityMemberships.has(key)) {
      this.communityMemberships.add(key);
      const c = this.communities.get(communityId);
      if (c) c.memberCount += 1;
      this.saveToDisk();
    }
    return { joined: true };
  }

  leaveCommunity(userId: string, communityId: string): { joined: boolean } {
    const key = `${communityId}:${userId}`;
    if (this.communityMemberships.has(key)) {
      this.communityMemberships.delete(key);
      const c = this.communities.get(communityId);
      if (c && c.memberCount > 0) c.memberCount -= 1;
      this.saveToDisk();
    }
    return { joined: false };
  }

  listCommunityPosts(communityId: string, userId: string, limit = 30): CommunityPostView[] {
    const list = Array.from(this.communityPosts.values()).filter((p) => p.communityId === communityId);
    list.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || b.createdAt.getTime() - a.createdAt.getTime());
    return list.slice(0, limit).map((p) => {
      const authorProfile = this.profiles.get(p.authorId);
      return {
        id: p.id,
        communityId: p.communityId,
        author: {
          id: p.authorId,
          nickname: authorProfile?.nickname ?? 'Student',
          avatarUrl: authorProfile?.avatarUrl ?? null,
          major: authorProfile?.major ?? null,
          graduationYear: authorProfile?.graduationYear ?? null,
        },
        title: p.title,
        content: p.content,
        likesCount: p.likesCount,
        repliesCount: p.repliesCount,
        isPinned: p.isPinned,
        hasLiked: this.communityPostLikes.has(`${p.id}:${userId}`),
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  createCommunityPost(user: CurrentUser, communityId: string, input: { title: string; content: string }): CommunityPostView {
    const c = this.communities.get(communityId);
    if (!c) throw notFound('Community not found');
    const postId = randomUUID();
    const now = new Date();
    const post: DevCommunityPost = {
      id: postId,
      communityId,
      campusId: user.campusId,
      authorId: user.id,
      title: input.title,
      content: input.content,
      likesCount: 0,
      repliesCount: 0,
      isPinned: false,
      createdAt: now,
    };
    this.communityPosts.set(postId, post);
    c.postCount += 1;
    this.communityMemberships.add(`${communityId}:${user.id}`);
    this.saveToDisk();

    const authorProfile = this.profiles.get(user.id);
    return {
      id: postId,
      communityId,
      author: {
        id: user.id,
        nickname: authorProfile?.nickname ?? 'Student',
        avatarUrl: authorProfile?.avatarUrl ?? null,
        major: authorProfile?.major ?? null,
        graduationYear: authorProfile?.graduationYear ?? null,
      },
      title: post.title,
      content: post.content,
      likesCount: 0,
      repliesCount: 0,
      isPinned: false,
      hasLiked: false,
      createdAt: now.toISOString(),
    };
  }

  toggleCommunityPostLike(userId: string, postId: string): { hasLiked: boolean; likesCount: number } {
    const post = this.communityPosts.get(postId);
    if (!post) throw notFound('Post not found');
    const key = `${postId}:${userId}`;
    const hasLiked = this.communityPostLikes.has(key);
    if (hasLiked) {
      this.communityPostLikes.delete(key);
      post.likesCount = Math.max(0, post.likesCount - 1);
    } else {
      this.communityPostLikes.add(key);
      post.likesCount += 1;
    }
    this.saveToDisk();
    return { hasLiked: !hasLiked, likesCount: post.likesCount };
  }

  listCommunityPostReplies(postId: string): CommunityReplyView[] {
    const replies = this.communityPostReplies.get(postId) ?? [];
    return replies.map((r) => {
      const authorProfile = this.profiles.get(r.authorId);
      return {
        id: r.id,
        postId: r.postId,
        author: {
          id: r.authorId,
          nickname: authorProfile?.nickname ?? 'Student',
          avatarUrl: authorProfile?.avatarUrl ?? null,
          major: authorProfile?.major ?? null,
          graduationYear: authorProfile?.graduationYear ?? null,
        },
        content: r.content,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  createCommunityPostReply(user: CurrentUser, postId: string, input: { content: string }): CommunityReplyView {
    const post = this.communityPosts.get(postId);
    if (!post) throw notFound('Post not found');
    const replyId = randomUUID();
    const now = new Date();
    const reply: DevCommunityPostReply = {
      id: replyId,
      postId,
      authorId: user.id,
      content: input.content,
      createdAt: now,
    };
    const list = this.communityPostReplies.get(postId) ?? [];
    list.push(reply);
    this.communityPostReplies.set(postId, list);
    post.repliesCount += 1;
    this.saveToDisk();

    const authorProfile = this.profiles.get(user.id);
    return {
      id: replyId,
      postId,
      author: {
        id: user.id,
        nickname: authorProfile?.nickname ?? 'Student',
        avatarUrl: authorProfile?.avatarUrl ?? null,
        major: authorProfile?.major ?? null,
        graduationYear: authorProfile?.graduationYear ?? null,
      },
      content: reply.content,
      createdAt: now.toISOString(),
    };
  }
}

export const devStore = new InMemoryDevStore();
