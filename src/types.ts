export type AppLanguage = 'pt' | 'en' | 'es';
export type AppCurrency = 'BRL' | 'USD' | 'EUR';

export interface DbUser {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: 'tourist' | 'merchant' | 'concierge' | 'subadmin' | 'admin';
  preferredLang: AppLanguage;
  preferredCurrency: AppCurrency;
  phone?: string | null;
  createdAt: string;
}

export interface MerchantPlan {
  id: number;
  slug: string;
  name: string;
  monthlyPriceCents: number;
  durationDays?: number;
  commissionBps: number;
  maxListings: number;
  featuredSlots: number;
  benefitsJson: string[];
  active: boolean;
}

export interface Merchant {
  id: number;
  userId: number;
  companyName: string;
  tradeName: string;
  documentNumber: string;
  cadasturNumber?: string | null;
  category: string;
  riskLevel: string;
  verificationStatus: 'pending' | 'verified' | 'rejected' | 'manual_review';
  verificationReason?: string | null;
  planId: number;
  planExpiresAt?: string | null;
  planStatus?: string | null;
  city: string;
  state: string;
  phone: string;
  bio: string;
  gbpConnected?: boolean;
  gbpAccountName?: string | null;
  gbpSyncedAt?: string | null;
  mpOauthConnected?: boolean;
  mpCollectorId?: string | null;
}

export interface Destination {
  id: number;
  slug: string;
  name: string;
  state: string;
  region: string;
  category: string;
  lat: number;
  lng: number;
  summary: string;
  description: string;
  bestSeason: string;
  howToGet: string;
  culturalInfo: string;
  curiosities: string;
  highlightsJson: string[];
  coverImage: string;
  avgBudgetDayCents: number;
  ratingAvg: number;
  reviewCount: number;
  featured: boolean;
}

export interface Listing {
  id: number;
  merchantId: number;
  destinationId: number;
  moduleType: 'experience' | 'gastronomy' | 'accommodation';
  subtype: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  priceCents: number;
  promoPriceCents?: number | null;
  promoLabel?: string | null;
  currency: string;
  capacity: number;
  durationOrCheckin: string;
  address: string;
  lat: number;
  lng: number;
  amenitiesJson: string[];
  galleryJson?: string[];
  videosJson?: string[];
  googlePlaceId?: string | null;
  menuOrScheduleJson: Array<{ label: string; detail: string; price?: string }>;
  cancellationPolicy: string;
  coverImage: string;
  isFeatured: boolean;
  isSponsored: boolean;
  status: 'active' | 'paused' | 'pending' | 'expired' | string;
  expiresAt?: string | null;
  ratingAvg: number;
  reviewCount: number;
  destinationName?: string;
  destinationState?: string;
  destinationSlug?: string;
  merchantTradeName?: string;
  merchantVerified?: boolean;
}

export interface AvailabilitySlot {
  id: number;
  listingId: number;
  date: string;
  timeSlot: string;
  totalSpots: number;
  availableSpots: number;
  priceOverrideCents?: number | null;
}

export interface ReviewItem {
  id: number;
  rating: number;
  comment: string;
  merchantReply?: string | null;
  createdAt: string;
  authorName: string;
}

export interface Booking {
  id: number;
  bookingCode: string;
  userId: number;
  listingId: number;
  slotId?: number | null;
  checkInDate: string;
  checkOutDate?: string | null;
  guestsCount: number;
  grossAmountCents: number;
  discountCents: number;
  commissionCents: number;
  netMerchantCents: number;
  currency: string;
  paymentMethod: string;
  paymentProvider: string;
  paymentRef?: string | null;
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'refunded';
  guestNotes?: string | null;
  createdAt: string;
}

export interface ConciergeRequest {
  id: number;
  requestCode: string;
  userId: number;
  originCity: string;
  destinationPref: string;
  startDate: string;
  endDate: string;
  travelersCount: number;
  budgetCents: number;
  tripStyle: string;
  notes: string;
  status: string;
  proposalSummary?: string | null;
  proposalAmountCents?: number | null;
  createdAt: string;
}

export interface TouristDocument {
  id: number;
  userId: number;
  docType: 'passport' | 'rg' | 'voucher' | 'ticket' | 'insurance' | string;
  label: string;
  maskedNumber: string;
  expiresAt?: string | null;
  createdAt: string;
}

export interface FlightAlert {
  id: number;
  userId: number;
  originIata: string;
  destinationIata: string;
  targetPriceBrl: number;
  includeMadrugada: boolean;
  active: boolean;
  createdAt: string;
}

export interface FlightOrder {
  id: number;
  orderCode: string;
  userId: number;
  idempotencyKey: string;
  provider: string;
  tripType: string;
  originIata: string;
  destinationIata: string;
  departureDate: string;
  returnDate?: string | null;
  carrierCode?: string | null;
  flightNumber?: string | null;
  isMadrugada: boolean;
  passengersJson: Array<{ name: string; docType?: string }>;
  supplierCostCents: number;
  platformFeeCents: number;
  paymentFeeCents: number;
  taxCents: number;
  totalClientCents: number;
  status: string;
  createdAt: string;
}

export interface NotificationItem {
  id: number;
  userId: number;
  category: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface PricingRule {
  id: number;
  ruleCode: string;
  name: string;
  category: string;
  markupType: 'fixed' | 'percent' | 'hybrid';
  markupFixedCents: number;
  markupBps: number;
  gatewayFeeBps: number;
  taxBps: number;
  notes: string;
  active: boolean;
  updatedAt?: string;
}

export interface PriceBreakdown {
  ruleCode: string;
  ruleName: string;
  supplierCostCents: number;
  platformRemunerationCents: number;
  paymentFeeCents: number;
  taxCents: number;
  discountCents: number;
  finalClientCents: number;
  merchantPayoutCents: number;
  estimatedMarginCents: number;
}

export interface FinancialLedgerEntry {
  id: number;
  operationType: string;
  referenceCode: string;
  category: string;
  ruleCode: string;
  supplierCostCents: number;
  platformRemunerationCents: number;
  paymentFeeCents: number;
  taxCents: number;
  finalClientCents: number;
  estimatedMarginCents: number;
  createdAt: string;
}

export interface AiAgent {
  id: number;
  code: string;
  name: string;
  department: string;
  objective: string;
  state: 'idle' | 'running' | 'waiting' | 'error';
  tasksCompleted: number;
  errorCount: number;
  estimatedCostUsdMicro: number;
  lastRunAt?: string | null;
}

export interface AgentTask {
  id: number;
  agentCode: string;
  department: string;
  triggerType: string;
  eventName: string;
  title: string;
  status: 'completed' | 'awaiting_approval' | 'blocked' | 'failed';
  requiresApproval: boolean;
  createdAt: string;
}

export interface EditorialPost {
  id: number;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  destinationSlug?: string | null;
  coverImage: string;
  keywordsJson: string[];
  publishDate: string;
  contentHash: string;
  imageHash: string;
  riskTier: 'low_auto' | 'commercial_review';
  status: 'published' | 'pending_review' | 'rejected';
  approvedByEmail?: string | null;
  createdAt: string;
}

export interface MarketingCampaign {
  id: number;
  merchantId: number;
  listingId?: number | null;
  title: string;
  channel: string;
  headline: string;
  adCopy: string;
  socialCaption: string;
  aiSuggestion?: string | null;
  status: 'draft' | 'active' | 'paused';
  impressions: number;
  clicks: number;
  contacts: number;
  conversions: number;
  createdAt: string;
}

export interface MerchantSubscriptionRow {
  subscription: {
    id: number;
    merchantId: number;
    planId: number;
    status: string;
    amountCents: number;
    paymentRef?: string | null;
    startsAt?: string | null;
    expiresAt?: string | null;
    autoRenew: boolean;
    courtesyByEmail?: string | null;
    createdAt: string;
  };
  planName: string;
  planSlug?: string;
  merchantName?: string;
}

export interface ChatConversation {
  id: number;
  conversationCode: string;
  ownerUserId: number;
  ownerUid: string;
  ownerName: string;
  channel: 'tourist' | 'merchant' | 'admin' | 'ai_handoff';
  subject: string;
  status: 'open' | 'human_assigned' | 'resolved';
  unreadByOwner: number;
  unreadByStaff: number;
  lastMessageAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderUid: string;
  senderName: string;
  senderRole: 'tourist' | 'merchant' | 'admin' | 'ai_agent';
  text: string;
  attachmentUrl?: string | null;
  readByStaff: boolean;
  createdAt: string;
}

export interface AdminPermissionRecord {
  id: number;
  email: string;
  label: string;
  permissionsJson: string[];
  grantedByEmail: string;
  active: boolean;
  createdAt: string;
}

export interface PopupTemplate {
  id?: number;
  code: string;
  title: string;
  description: string;
  ctaLabel: string;
  targetAction: string;
  category: string;
  visualVariant: 'neon-emerald' | 'pink-pulse' | 'gold-luxury' | 'obsidian-neon' | 'prism-tropical' | string;
  imageUrl: string;
  emoji: string;
  priority: number;
  durationMs: number;
  audience: 'all' | 'tourists' | 'merchants' | string;
  campaignName: string;
  displayRule: string;
  validFrom: string;
  validUntil: string;
  active: boolean;
  createdByEmail?: string;
  createdAt?: string;
}

export type IdentityStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'manual_review';

export interface IdentityPublic {
  status: IdentityStatus;
  reason: string | null;
  cpfMasked: string | null;
  hasDocumentImage: boolean;
  hasSelfieImage: boolean;
  decidedAt: string | null;
}
