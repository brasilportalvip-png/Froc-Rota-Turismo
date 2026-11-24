import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull().default('Viajante'),
  role: text('role').notNull().default('tourist'), // 'tourist' | 'merchant' | 'concierge' | 'subadmin' | 'admin'
  preferredLang: text('preferred_lang').notNull().default('pt'), // 'pt' | 'en' | 'es'
  preferredCurrency: text('preferred_currency').notNull().default('BRL'), // 'BRL' | 'USD' | 'EUR'
  phone: text('phone'),
  lgpdConsentAt: timestamp('lgpd_consent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const adminPermissions = pgTable('admin_permissions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  email: text('email').notNull().unique(),
  label: text('label').notNull().default('Administrador Secundário'),
  permissionsJson: jsonb('permissions_json').$type<string[]>().notNull().default([]),
  grantedByEmail: text('granted_by_email').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const merchantPlans = pgTable('merchant_plans', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(), // 'free' | 'basic' | 'pro' | 'premium'
  name: text('name').notNull(),
  monthlyPriceCents: integer('monthly_price_cents').notNull().default(0),
  durationDays: integer('duration_days').notNull().default(30),
  commissionBps: integer('commission_bps').notNull().default(1800), // 18.00%
  maxListings: integer('max_listings').notNull().default(3),
  featuredSlots: integer('featured_slots').notNull().default(0),
  benefitsJson: jsonb('benefits_json').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const merchants = pgTable('merchants', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull()
    .unique(),
  companyName: text('company_name').notNull(),
  tradeName: text('trade_name').notNull(),
  documentNumber: text('document_number').notNull(),
  cadasturNumber: text('cadastur_number'),
  category: text('category').notNull(), // 'nautical' | 'tours' | 'gastronomy' | 'hospitality' | 'transport'
  riskLevel: text('risk_level').notNull().default('standard'), // 'standard' | 'high_risk_nautical'
  verificationStatus: text('verification_status').notNull().default('pending'), // 'pending' | 'verified' | 'rejected'
  planId: integer('plan_id')
    .references(() => merchantPlans.id)
    .notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  phone: text('phone').notNull(),
  bio: text('bio').notNull().default(''),
  mpCollectorId: text('mp_collector_id'),
  mpOauthConnected: boolean('mp_oauth_connected').notNull().default(false),
  gbpConnected: boolean('gbp_connected').notNull().default(false),
  gbpAccountName: text('gbp_account_name'),
  gbpLocationId: text('gbp_location_id'),
  gbpSyncedAt: timestamp('gbp_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const merchantSubscriptions = pgTable('merchant_subscriptions', {
  id: serial('id').primaryKey(),
  merchantId: integer('merchant_id')
    .references(() => merchants.id)
    .notNull(),
  planId: integer('plan_id')
    .references(() => merchantPlans.id)
    .notNull(),
  status: text('status').notNull().default('pending_payment'), // 'pending_payment' | 'active' | 'expired' | 'suspended' | 'cancelled' | 'courtesy'
  amountCents: integer('amount_cents').notNull().default(0),
  paymentRef: text('payment_ref'),
  startsAt: timestamp('starts_at'),
  expiresAt: timestamp('expires_at'),
  autoRenew: boolean('auto_renew').notNull().default(true),
  courtesyByEmail: text('courtesy_by_email'),
  expiryWarned: boolean('expiry_warned').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const oauthConnections = pgTable('oauth_connections', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  merchantId: integer('merchant_id').references(() => merchants.id),
  provider: text('provider').notNull(), // 'google_business' | 'mercadopago_seller'
  externalAccountId: text('external_account_id'),
  externalAccountName: text('external_account_name'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  scope: text('scope'),
  status: text('status').notNull().default('connected'), // 'connected' | 'revoked' | 'error'
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const destinations = pgTable('destinations', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  state: text('state').notNull(),
  region: text('region').notNull(), // 'Nordeste' | 'Sudeste' | 'Centro-Oeste' | 'Sul' | 'Norte'
  category: text('category').notNull(), // 'praia' | 'ilha' | 'cachoeira' | 'montanha' | 'parque' | 'historico'
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  summary: text('summary').notNull(),
  description: text('description').notNull(),
  bestSeason: text('best_season').notNull(),
  howToGet: text('how_to_get').notNull(),
  culturalInfo: text('cultural_info').notNull(),
  curiosities: text('curiosities').notNull(),
  highlightsJson: jsonb('highlights_json').$type<string[]>().notNull().default([]),
  coverImage: text('cover_image').notNull(),
  avgBudgetDayCents: integer('avg_budget_day_cents').notNull().default(45000),
  ratingAvg: doublePrecision('rating_avg').notNull().default(4.9),
  reviewCount: integer('review_count').notNull().default(0),
  featured: boolean('featured').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const listings = pgTable('listings', {
  id: serial('id').primaryKey(),
  merchantId: integer('merchant_id')
    .references(() => merchants.id)
    .notNull(),
  destinationId: integer('destination_id')
    .references(() => destinations.id)
    .notNull(),
  moduleType: text('module_type').notNull(), // 'experience' | 'gastronomy' | 'accommodation'
  subtype: text('subtype').notNull(), // 'lancha' | 'mergulho' | 'trilha' | 'restaurante' | 'bar_praia' | 'hotel' | 'pousada' | 'chale'
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  summary: text('summary').notNull(),
  description: text('description').notNull(),
  priceCents: integer('price_cents').notNull(),
  promoPriceCents: integer('promo_price_cents'),
  promoLabel: text('promo_label'),
  currency: text('currency').notNull().default('BRL'),
  capacity: integer('capacity').notNull().default(10),
  durationOrCheckin: text('duration_or_checkin').notNull().default('3h'),
  address: text('address').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  amenitiesJson: jsonb('amenities_json').$type<string[]>().notNull().default([]),
  menuOrScheduleJson: jsonb('menu_or_schedule_json')
    .$type<Array<{ label: string; detail: string; price?: string }>>()
    .notNull()
    .default([]),
  galleryJson: jsonb('gallery_json').$type<string[]>().notNull().default([]),
  videosJson: jsonb('videos_json').$type<string[]>().notNull().default([]),
  googlePlaceId: text('google_place_id'),
  cancellationPolicy: text('cancellation_policy').notNull(),
  coverImage: text('cover_image').notNull(),
  isFeatured: boolean('is_featured').notNull().default(false),
  isSponsored: boolean('is_sponsored').notNull().default(false),
  status: text('status').notNull().default('active'), // 'active' | 'pending' | 'paused'
  viewsCount: integer('views_count').notNull().default(0),
  clicksCount: integer('clicks_count').notNull().default(0),
  expiresAt: timestamp('expires_at'),
  ratingAvg: doublePrecision('rating_avg').notNull().default(4.8),
  reviewCount: integer('review_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const availabilitySlots = pgTable('availability_slots', {
  id: serial('id').primaryKey(),
  listingId: integer('listing_id')
    .references(() => listings.id)
    .notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  timeSlot: text('time_slot').notNull(), // e.g. '09:00' or 'Diária'
  totalSpots: integer('total_spots').notNull(),
  availableSpots: integer('available_spots').notNull(),
  priceOverrideCents: integer('price_override_cents'),
});

export const pricingRules = pgTable('pricing_rules', {
  id: serial('id').primaryKey(),
  ruleCode: text('rule_code').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(), // 'flights' | 'accommodation' | 'experience' | 'gastronomy' | 'plans'
  serviceType: text('service_type').notNull().default('all'),
  merchantId: integer('merchant_id').references(() => merchants.id),
  planSlug: text('plan_slug').notNull().default('all'),
  markupType: text('markup_type').notNull().default('fixed'), // 'fixed' | 'percent' | 'hybrid'
  markupFixedCents: integer('markup_fixed_cents').notNull().default(0),
  markupBps: integer('markup_bps').notNull().default(0), // basis points over cost
  minPriceCents: integer('min_price_cents').notNull().default(0),
  maxPriceCents: integer('max_price_cents').notNull().default(100000000),
  gatewayFeeBps: integer('gateway_fee_bps').notNull().default(399), // e.g. 3.99% Mercado Pago avg
  taxBps: integer('tax_bps').notNull().default(600), // e.g. 6% Simples Nacional / ISS estimate
  maxFinalMarkupRatioBps: integer('max_final_markup_ratio_bps').notNull().default(10000), // contractual guard <= 100%
  active: boolean('active').notNull().default(true),
  notes: text('notes').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const financialLedger = pgTable('financial_ledger', {
  id: serial('id').primaryKey(),
  entryCode: text('entry_code').notNull().unique(),
  operationType: text('operation_type').notNull(), // 'booking_charge' | 'flight_charge' | 'plan_charge' | 'refund'
  referenceCode: text('reference_code').notNull(),
  category: text('category').notNull(),
  supplierCostCents: integer('supplier_cost_cents').notNull(),
  platformRemunerationCents: integer('platform_remuneration_cents').notNull(),
  paymentFeeCents: integer('payment_fee_cents').notNull().default(0),
  taxCents: integer('tax_cents').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  finalClientCents: integer('final_client_cents').notNull(),
  merchantPayoutCents: integer('merchant_payout_cents').notNull(),
  estimatedMarginCents: integer('estimated_margin_cents').notNull(),
  currency: text('currency').notNull().default('BRL'),
  ruleSnapshotJson: jsonb('rule_snapshot_json').$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text('idempotency_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  scope: text('scope').notNull(),
  userId: integer('user_id').references(() => users.id),
  statusCode: integer('status_code').notNull().default(200),
  responseJson: jsonb('response_json').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const coupons = pgTable('coupons', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  discountPercent: integer('discount_percent').notNull(),
  maxUses: integer('max_uses').notNull().default(100),
  usedCount: integer('used_count').notNull().default(0),
  active: boolean('active').notNull().default(true),
  expiresAt: text('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bookings = pgTable('bookings', {
  id: serial('id').primaryKey(),
  bookingCode: text('booking_code').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  listingId: integer('listing_id')
    .references(() => listings.id)
    .notNull(),
  slotId: integer('slot_id').references(() => availabilitySlots.id),
  checkInDate: text('check_in_date').notNull(),
  checkOutDate: text('check_out_date'),
  guestsCount: integer('guests_count').notNull().default(1),
  couponCode: text('coupon_code'),
  supplierCostCents: integer('supplier_cost_cents').notNull().default(0),
  grossAmountCents: integer('gross_amount_cents').notNull(),
  discountCents: integer('discount_cents').notNull().default(0),
  commissionCents: integer('commission_cents').notNull().default(0),
  netMerchantCents: integer('net_merchant_cents').notNull(),
  currency: text('currency').notNull().default('BRL'),
  paymentMethod: text('payment_method').notNull().default('pix'), // 'pix' | 'card' | 'mercadopago'
  paymentProvider: text('payment_provider').notNull().default('mercadopago'),
  paymentRef: text('payment_ref'),
  idempotencyKey: text('idempotency_key'),
  status: text('status').notNull().default('pending_payment'), // 'pending_payment' | 'confirmed' | 'cancelled' | 'refunded'
  guestNotes: text('guest_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  bookingId: integer('booking_id')
    .references(() => bookings.id)
    .notNull(),
  provider: text('provider').notNull(), // 'mercadopago' | 'stripe'
  externalId: text('external_id').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'paid' | 'failed' | 'refunded'
  amountCents: integer('amount_cents').notNull(),
  verifiedByServerWebhook: boolean('verified_by_server_webhook').notNull().default(false),
  webhookEventType: text('webhook_event_type'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const flightOrders = pgTable('flight_orders', {
  id: serial('id').primaryKey(),
  orderCode: text('order_code').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  provider: text('provider').notNull(),
  tripType: text('trip_type').notNull().default('one_way'), // 'one_way' | 'round_trip' | 'multi_city'
  originIata: text('origin_iata').notNull(),
  destinationIata: text('destination_iata').notNull(),
  departureDate: text('departure_date').notNull(),
  returnDate: text('return_date'),
  carrierCode: text('carrier_code'),
  flightNumber: text('flight_number'),
  isMadrugada: boolean('is_madrugada').notNull().default(false),
  passengersJson: jsonb('passengers_json').$type<Array<{ name: string; document: string; birthDate?: string }>>().notNull().default([]),
  supplierCostCents: integer('supplier_cost_cents').notNull(),
  platformFeeCents: integer('platform_fee_cents').notNull(),
  paymentFeeCents: integer('payment_fee_cents').notNull().default(0),
  taxCents: integer('tax_cents').notNull().default(0),
  totalClientCents: integer('total_client_cents').notNull(),
  fareConditions: text('fare_conditions').notNull().default('Condições oficiais da companhia emissora'),
  status: text('status').notNull().default('fare_confirmed'), // 'fare_confirmed' | 'pending_payment' | 'paid' | 'issuance_requested' | 'issued' | 'cancelled' | 'failed'
  pnrCode: text('pnr_code'),
  ticketNumber: text('ticket_number'),
  paymentRef: text('payment_ref'),
  emailDispatched: boolean('email_dispatched').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const flightAlerts = pgTable('flight_alerts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  originIata: text('origin_iata').notNull(),
  destinationIata: text('destination_iata').notNull(),
  targetPriceBrl: integer('target_price_brl').notNull(),
  includeMadrugada: boolean('include_madrugada').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const aiAgents = pgTable('ai_agents', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // 'AGT-001' .. 'AGT-200'
  name: text('name').notNull(),
  department: text('department').notNull(),
  specialty: text('specialty').notNull(),
  objective: text('objective').notNull(),
  instructions: text('instructions').notNull(),
  allowedToolsJson: jsonb('allowed_tools_json').$type<string[]>().notNull().default([]),
  accessScope: text('access_scope').notNull().default('read_catalog_only'),
  supervisorEmail: text('supervisor_email').notNull().default('brasilportalvip@gmail.com'),
  state: text('state').notNull().default('idle'), // 'idle' | 'running' | 'waiting' | 'error'
  tasksCompleted: integer('tasks_completed').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  avgDurationMs: integer('avg_duration_ms').notNull().default(420),
  estimatedCostUsdMicro: integer('estimated_cost_usd_micro').notNull().default(0),
  lastError: text('last_error'),
  requiresFinancialApproval: boolean('requires_financial_approval').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const agentTasks = pgTable('agent_tasks', {
  id: serial('id').primaryKey(),
  taskCode: text('task_code').notNull().unique(),
  agentId: integer('agent_id')
    .references(() => aiAgents.id)
    .notNull(),
  agentCode: text('agent_code').notNull(),
  triggerType: text('trigger_type').notNull().default('event'), // 'event' | 'schedule' | 'request'
  eventName: text('event_name').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('completed'), // 'queued' | 'running' | 'completed' | 'failed' | 'awaiting_approval'
  inputJson: jsonb('input_json').$type<Record<string, unknown>>().notNull().default({}),
  resultSummary: text('result_summary'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms').notNull().default(0),
  aiCostUsdMicro: integer('ai_cost_usd_micro').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const editorialPosts = pgTable('editorial_posts', {
  id: serial('id').primaryKey(),
  postCode: text('post_code').notNull().unique(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  body: text('body').notNull(),
  category: text('category').notNull(), // 'praias' | 'destinos' | 'gastronomia' | 'cultura' | 'curiosidades' | 'passeios' | 'hospedagens' | 'eventos' | 'turismo_regional' | 'promocoes'
  destinationSlug: text('destination_slug'),
  keywordsJson: jsonb('keywords_json').$type<string[]>().notNull().default([]),
  coverImage: text('cover_image').notNull(),
  imageHash: text('image_hash').notNull(),
  contentHash: text('content_hash').notNull().unique(),
  sourceReliability: text('source_reliability').notNull().default('verified_catalog_db'),
  imageLicense: text('image_license').notNull().default('froc_rota_owned_asset'),
  language: text('language').notNull().default('pt'),
  authorAgentCode: text('author_agent_code').notNull(),
  riskTier: text('risk_tier').notNull().default('low_auto'), // 'low_auto' | 'commercial_review'
  status: text('status').notNull().default('pending_review'), // 'pending_review' | 'published' | 'rejected'
  publishDate: text('publish_date').notNull(), // YYYY-MM-DD
  approvedByEmail: text('approved_by_email'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const marketingCampaigns = pgTable('marketing_campaigns', {
  id: serial('id').primaryKey(),
  merchantId: integer('merchant_id')
    .references(() => merchants.id)
    .notNull(),
  listingId: integer('listing_id').references(() => listings.id),
  title: text('title').notNull(),
  channel: text('channel').notNull().default('froc_featured'), // 'instagram' | 'google_ads' | 'trivago' | 'froc_featured'
  headline: text('headline').notNull(),
  adCopy: text('ad_copy').notNull(),
  socialCaption: text('social_caption').notNull().default(''),
  status: text('status').notNull().default('active'), // 'draft' | 'active' | 'paused'
  impressions: integer('impressions').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  contacts: integer('contacts').notNull().default(0),
  conversions: integer('conversions').notNull().default(0),
  aiSuggestion: text('ai_suggestion'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const chatConversations = pgTable('chat_conversations', {
  id: serial('id').primaryKey(),
  conversationCode: text('conversation_code').notNull().unique(),
  ownerUserId: integer('owner_user_id')
    .references(() => users.id)
    .notNull(),
  ownerUid: text('owner_uid').notNull(),
  ownerName: text('owner_name').notNull(),
  channel: text('channel').notNull().default('tourist'), // 'tourist' | 'merchant' | 'admin' | 'ai_handoff'
  subject: text('subject').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'human_assigned' | 'resolved'
  assignedAdminEmail: text('assigned_admin_email'),
  unreadByOwner: integer('unread_by_owner').notNull().default(0),
  unreadByStaff: integer('unread_by_staff').notNull().default(1),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id')
    .references(() => chatConversations.id)
    .notNull(),
  senderUid: text('sender_uid').notNull(),
  senderName: text('sender_name').notNull(),
  senderRole: text('sender_role').notNull(), // 'tourist' | 'merchant' | 'admin' | 'ai_agent'
  text: text('text').notNull(),
  attachmentUrl: text('attachment_url'),
  readByStaff: boolean('read_by_staff').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const touristDocuments = pgTable('tourist_documents', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  docType: text('doc_type').notNull(), // 'passport' | 'rg' | 'voucher' | 'ticket' | 'insurance'
  label: text('label').notNull(),
  maskedNumber: text('masked_number').notNull().default(''),
  expiresAt: text('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  kind: text('kind').notNull().default('system'), // 'booking' | 'payment' | 'flight' | 'chat' | 'plan' | 'system'
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  destinationId: integer('destination_id').references(() => destinations.id),
  listingId: integer('listing_id').references(() => listings.id),
  rating: integer('rating').notNull(),
  comment: text('comment').notNull(),
  merchantReply: text('merchant_reply'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const favorites = pgTable('favorites', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  destinationId: integer('destination_id').references(() => destinations.id),
  listingId: integer('listing_id').references(() => listings.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const savedItineraries = pgTable('saved_itineraries', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  title: text('title').notNull(),
  destinationSlug: text('destination_slug'),
  budgetCents: integer('budget_cents').notNull().default(0),
  daysCount: integer('days_count').notNull().default(3),
  contentJson: jsonb('content_json').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const conciergeRequests = pgTable('concierge_requests', {
  id: serial('id').primaryKey(),
  requestCode: text('request_code').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  originCity: text('origin_city').notNull(),
  destinationPref: text('destination_pref').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  travelersCount: integer('travelers_count').notNull().default(2),
  budgetCents: integer('budget_cents').notNull(),
  tripStyle: text('trip_style').notNull(),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('new'), // 'new' | 'quoting' | 'proposal_sent' | 'approved' | 'paid' | 'completed'
  proposalSummary: text('proposal_summary'),
  proposalAmountCents: integer('proposal_amount_cents'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  targetType: text('target_type').notNull(), // 'listing' | 'review' | 'merchant'
  targetId: integer('target_id').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'resolved' | 'dismissed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorUserId: integer('actor_user_id'),
  actorEmail: text('actor_email'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  detailsJson: jsonb('details_json').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const popupTemplates = pgTable('popup_templates', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  ctaLabel: text('cta_label').notNull(),
  targetAction: text('target_action').notNull(), // e.g. 'section:#viagens' | 'dest:paraty' | 'modal:ai' | 'coupon:FROC10'
  category: text('category').notNull(),
  visualVariant: text('visual_variant').notNull().default('neon-emerald'),
  imageUrl: text('image_url').notNull(),
  emoji: text('emoji').notNull().default('✨'),
  priority: integer('priority').notNull().default(50),
  durationMs: integer('duration_ms').notNull().default(6000),
  audience: text('audience').notNull().default('all'), // 'all' | 'tourists' | 'merchants'
  campaignName: text('campaign_name').notNull().default('Campanha Oficial Froc Rota'),
  displayRule: text('display_rule').notNull().default('engaged_scroll'),
  validFrom: text('valid_from').notNull().default('2025-01-01'),
  validUntil: text('valid_until').notNull().default('2028-12-31'),
  active: boolean('active').notNull().default(true),
  createdByEmail: text('created_by_email').notNull().default('system@frocrota.example'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  merchant: one(merchants, {
    fields: [users.id],
    references: [merchants.userId],
  }),
  bookings: many(bookings),
  favorites: many(favorites),
  conciergeRequests: many(conciergeRequests),
}));

export const merchantsRelations = relations(merchants, ({ one, many }) => ({
  user: one(users, {
    fields: [merchants.userId],
    references: [users.id],
  }),
  plan: one(merchantPlans, {
    fields: [merchants.planId],
    references: [merchantPlans.id],
  }),
  listings: many(listings),
  subscriptions: many(merchantSubscriptions),
  campaigns: many(marketingCampaigns),
}));

export const destinationsRelations = relations(destinations, ({ many }) => ({
  listings: many(listings),
  reviews: many(reviews),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  merchant: one(merchants, {
    fields: [listings.merchantId],
    references: [merchants.id],
  }),
  destination: one(destinations, {
    fields: [listings.destinationId],
    references: [destinations.id],
  }),
  slots: many(availabilitySlots),
  bookings: many(bookings),
  reviews: many(reviews),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  user: one(users, {
    fields: [bookings.userId],
    references: [users.id],
  }),
  listing: one(listings, {
    fields: [bookings.listingId],
    references: [listings.id],
  }),
  payments: many(payments),
}));
