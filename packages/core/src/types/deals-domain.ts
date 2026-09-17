import type {
  ContentEligibility,
  ContentPostSlot,
  DealCategory,
  DealContentPostStatus,
  DealSourceType,
  DealVerificationStatus,
  DedupStatus,
  FreshnessStatus,
  MerchantCategory,
  MerchantTier,
  ScrapingMethod,
  SubmissionSourceType,
  SubmissionStatus,
} from "./deals-enums.js";

/** Deals-specific fields layered onto the shared `schools` tenant row (spec
 * "Universities table"). A school IS a university in this system — UCF is a
 * second row in the same table FAU already lives in, not a new concept. */
export interface UniversityDealsProfile {
  studentPopulation?: number | null;
  primaryRadiusMiles: number;
  secondaryRadiusMiles: number;
  commercialCorridors: string[];
  dealsInstagramAccount?: string | null;
}

export interface Merchant {
  id: string;
  universityId: string;
  name: string;
  category: MerchantCategory;
  subcategory?: string | null;
  streetAddress?: string | null;
  latitude: number;
  longitude: number;
  distanceFromCampusMiles: number;
  estimatedDriveTimeMinutes?: number | null;
  website?: string | null;
  instagramUrl?: string | null;
  onlineOrderingUrl?: string | null;
  specialsUrl?: string | null;
  menuUrl?: string | null;
  rewardsUrl?: string | null;
  newsletterUrl?: string | null;
  discoverySource: string;
  studentRelevanceScore: number; // 0-100
  monitoringTier: MerchantTier;
  active: boolean;
  dateAdded: string;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantSource {
  id: string;
  merchantId: string;
  sourceType: DealSourceType;
  sourceUrl: string;
  monitorFrequencyHours: number;
  lastCheckedAt?: string | null;
  lastChangedAt?: string | null;
  lastSuccessfulCheckAt?: string | null;
  contentHash?: string | null;
  active: boolean;
  scrapingMethod: ScrapingMethod;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealQualityBreakdown {
  studentUsefulness: number;
  savingsValue: number;
  proximity: number;
  freshnessUrgency: number;
  shareability: number;
  merchantRelevance: number;
}

export interface Deal {
  id: string;
  merchantId: string;
  universityId: string;
  title: string;
  rawOfferText?: string | null;
  cleanOfferDescription: string;
  dealCategory: DealCategory;
  normalPrice?: string | null;
  dealPrice?: string | null;
  discountPercent?: number | null;
  discountDollars?: number | null;
  isBogo: boolean;
  isFreeItem: boolean;
  studentIdRequired: boolean;
  promoCode?: string | null;
  validDaysOfWeek: number[]; // 0=Sunday..6=Saturday, [] = unspecified/every day
  startDate?: string | null;
  expirationDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  recurring: boolean;
  recurrencePattern?: string | null;
  locationRestrictions?: string | null;
  minimumPurchase?: string | null;
  eligibility?: string | null;
  sourceUrl?: string | null;
  sourceType: DealSourceType;
  dateDiscovered: string;
  dateLastVerified?: string | null;
  confidenceScore: number; // 0..1
  verificationStatus: DealVerificationStatus;
  freshnessStatus: FreshnessStatus;
  qualityScore: number; // 0-100
  qualityBreakdown: DealQualityBreakdown;
  contentEligibility: ContentEligibility;
  fingerprint: string;
  dedupStatus: DedupStatus;
  submissionSource: SubmissionSourceType;
  timesUsed: number;
  lastFeedPostedDate?: string | null;
  lastStoryPostedDate?: string | null;
  lastContentFormat?: string | null;
  flags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DealUniversityLink {
  dealId: string;
  universityId: string;
  distanceMiles?: number | null;
  nearestLocationAddress?: string | null;
  eligible: boolean;
}

export interface DealContentPost {
  id: string;
  universityId: string;
  slot: ContentPostSlot;
  scheduledDate: string;
  title: string;
  caption?: string | null;
  status: DealContentPostStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealContentPostLink {
  postId: string;
  dealId: string;
  position: number;
}

export interface VerificationRecord {
  id: string;
  dealId: string;
  verifiedAt: string;
  verificationStatus: DealVerificationStatus;
  verificationSource?: string | null;
  verifiedBy?: string | null;
  notes?: string | null;
}

export interface PerformanceMetric {
  id: string;
  dealId: string;
  contentPostId?: string | null;
  platform: string;
  reach?: number | null;
  views?: number | null;
  shares?: number | null;
  saves?: number | null;
  likes?: number | null;
  comments?: number | null;
  profileVisits?: number | null;
  followsGenerated?: number | null;
  linkClicks?: number | null;
  redemptions?: number | null;
  revenue?: number | null;
  sponsoredRevenue?: number | null;
  recordedAt: string;
}

export interface Submission {
  id: string;
  universityId: string;
  merchantId?: string | null;
  submissionType: SubmissionSourceType;
  submittedBy?: string | null;
  contactInfo?: string | null;
  rawText: string;
  status: SubmissionStatus;
  dealId?: string | null;
  createdAt: string;
}
