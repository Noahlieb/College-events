import type {
  EventCategory,
  EventStatus,
  PostStatus,
  PostType,
  ProcessingStatus,
  SourceCategory,
  SourceType,
  VerificationStatus,
} from "./enums.js";

/** A field value paired with the AI/extraction confidence that produced it. */
export interface ConfidenceField<T> {
  value: T | null;
  confidence: number; // 0..1
}

export interface SchoolBranding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  logoUrl?: string | null;
  fontFamily?: string | null;
}

export interface WeeklyScheduleSlot {
  postType: PostType;
  dayOfWeek: number; // 0 = Sunday ... 6 = Saturday
  label: string;
  hour: number; // local hour to publish, 0-23
  minute: number;
}

export interface School {
  id: string;
  name: string;
  shortName: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  timezone: string;
  active: boolean;
  branding: SchoolBranding;
  defaultRadiusMiles: number;
  weeklySchedule: WeeklyScheduleSlot[];
  instagramAccount?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  schoolId: string;
  name: string;
  sourceType: SourceType;
  category: SourceCategory;
  url?: string | null;
  instagramHandle?: string | null;
  priority: number; // 1 (low) - 10 (high / most authoritative)
  active: boolean;
  scrapeFrequencyMinutes: number;
  lastCheckedAt?: string | null;
  lastSuccessfulCheckAt?: string | null;
  consecutiveFailures: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RawContent {
  id: string;
  schoolId: string;
  sourceId: string;
  externalId?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
  mediaUrl?: string | null;
  localMediaPath?: string | null;
  publishedAt?: string | null;
  discoveredAt: string;
  rawMetadata: Record<string, unknown>;
  processingStatus: ProcessingStatus;
  createdAt: string;
}

export interface BucketScores {
  overall: number;
  mondayCampus: number;
  midweekActivity: number;
  thursdayNightlife: number;
}

export interface EventFieldConfidence {
  eventName: number;
  date: number;
  startTime: number;
  endTime: number;
  venue: number;
  price: number;
  category: number;
}

export interface EventRecord {
  id: string;
  schoolId: string;
  name: string;
  description?: string | null;
  startAt: string; // ISO timestamp
  endAt?: string | null;
  venue?: string | null;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  price?: string | null;
  ageRequirement?: string | null;
  category: EventCategory;
  tags: EventCategory[];
  organization?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  sourceImage?: string | null;
  originalRawContentId: string;
  confidenceScore: number; // 0..1 overall extraction confidence
  fieldConfidence: EventFieldConfidence;
  relevanceScore: number; // 0..100 legacy overall FAU-style score
  bucketScores: BucketScores;
  verificationStatus: VerificationStatus;
  status: EventStatus;
  flags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EventSourceLink {
  eventId: string;
  rawContentId: string;
  sourceId: string;
  sourceUrl?: string | null;
}

export interface Post {
  id: string;
  schoolId: string;
  postType: PostType;
  scheduledDate: string; // ISO date
  title: string;
  caption?: string | null;
  status: PostStatus;
  schedulerId?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostEventLink {
  postId: string;
  eventId: string;
  position: number;
  slideNumber: number;
}

export interface RenderedAsset {
  id: string;
  postId: string;
  eventId?: string | null;
  storageUrl: string;
  width: number;
  height: number;
  template: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProcessingLogEntry {
  id: string;
  schoolId?: string | null;
  level: "debug" | "info" | "warn" | "error";
  scope: string; // e.g. "ingestion.owl_central", "ai.extract_event"
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
