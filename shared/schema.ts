import { pgTable, text, serial, integer, boolean, timestamp, jsonb, json, decimal, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import * as z from "zod";

// Update the role enum to include superadmin
export const roleEnum = sql`CREATE TYPE "role" AS ENUM ('superadmin', 'admin', 'user', 'pending')`;

// Create enum columns
const role = sql`"role"`;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  role: text("role", { enum: ['superadmin', 'admin', 'user', 'pending'] }).notNull().default('pending'),
  enabled: boolean("enabled").notNull().default(true),
  approved: boolean("approved").notNull().default(false),
  can_view_nsfw: boolean("can_view_nsfw").notNull().default(false),
  show_uptime_log: boolean("show_uptime_log").notNull().default(false),
  show_service_url: boolean("show_service_url").notNull().default(true),
  show_refresh_interval: boolean("show_refresh_interval").notNull().default(true),
  show_last_checked: boolean("show_last_checked").notNull().default(true),
  service_order: integer("service_order").array().default([]),
  isOnline: boolean("is_online").notNull().default(false),
  last_login: timestamp("last_login"),
  last_ip: text("last_ip"),
  temp_password: boolean("temp_password").notNull().default(false),
  reset_token: text("reset_token"),
  kindle_email: text("kindle_email"),
  has_seen_first_time_dialog: boolean("has_seen_first_time_dialog").notNull().default(false),
});

// Session table managed by connect-pg-simple - defined here so Drizzle doesn't try to delete it
export const userSessions = pgTable("user_sessions", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  default_role: text("default_role", { enum: ['admin', 'user', 'pending'] }).notNull().default('pending'),
  site_title: text("site_title").default("Homelab Dashboard"),
  site_description: text("site_description").default("Monitor your services and game servers in real-time with our comprehensive dashboard."),
  site_keywords: text("site_keywords").default("homelab, dashboard, monitoring, services, game servers"),
  og_image_url: text("og_image_url"),
  font_family: text("font_family").default("Inter"),
  logo_url: text("logo_url"),
  logo_url_large: text("logo_url_large"),
  favicon_url: text("favicon_url"),
  favicon_label: text("favicon_label"),
  tracking_code: text("tracking_code"),
  login_description: text("login_description").default("Monitor your services and game servers in real-time with our comprehensive dashboard."),
  online_color: text("online_color").default("#22c55e"),
  offline_color: text("offline_color").default("#ef4444"),
  discord_url: text("discord_url").default("https://discord.gg/YhGnr92Bep"),
  show_refresh_interval: boolean("show_refresh_interval").default(true),
  show_last_checked: boolean("show_last_checked").default(true),
  show_service_url: boolean("show_service_url").default(true),
  show_uptime_log: boolean("show_uptime_log").default(false),
  show_status_badge: boolean("show_status_badge").default(true),
  admin_show_refresh_interval: boolean("admin_show_refresh_interval").default(true),
  admin_show_last_checked: boolean("admin_show_last_checked").default(true),
  admin_show_service_url: boolean("admin_show_service_url").default(true),
  admin_show_uptime_log: boolean("admin_show_uptime_log").default(false),
  admin_show_status_badge: boolean("admin_show_status_badge").default(true),
});

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  status: boolean("status").default(false),
  lastChecked: text("lastChecked").notNull(),
  icon: text("icon"),
  background: text("background"),
  refreshInterval: integer("refreshInterval").default(30),
  isNSFW: boolean("isNSFW").default(false),
  tooltip: text("tooltip"),
  show_status_badge: boolean("show_status_badge").default(true),
});

export const gameServers = pgTable("gameServers", {
  id: serial("id").primaryKey(),
  instanceId: text("instanceId").notNull(),  // AMP Instance ID
  name: text("name").notNull(),
  displayName: text("displayName"),  // Optional custom name
  type: text("type").notNull(),
  status: boolean("status").default(false),
  playerCount: integer("playerCount").default(0),
  maxPlayers: integer("maxPlayers").default(0),
  hidden: boolean("hidden").default(false),  // Whether to hide this instance
  icon: text("icon"),
  background: text("background"),
  show_player_count: boolean("show_player_count").default(true),
  show_status_badge: boolean("show_status_badge").default(true),
  autoStart: boolean("autoStart").default(false),
  lastStatusCheck: timestamp("lastStatusCheck"),
  refreshInterval: integer("refreshInterval").default(30),
});

export const serviceStatusLogs = pgTable("serviceStatusLogs", {
  id: serial("id").primaryKey(),
  serviceId: integer("serviceId").notNull().references(() => services.id, { onDelete: 'cascade' }),
  status: boolean("status").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  responseTime: integer("responseTime"),
});

export const notificationPreferences = pgTable("notificationPreferences", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: 'cascade' }),
  serviceId: integer("serviceId").notNull().references(() => services.id, { onDelete: 'cascade' }),
  email: text("email").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const emailTemplates = pgTable("emailTemplates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  template: text("template").notNull(),
  defaultTemplate: boolean("defaultTemplate").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const sentNotifications = pgTable("sentNotifications", {
  id: serial("id").primaryKey(),
  preferenceId: integer("preferenceId").notNull().references(() => notificationPreferences.id, { onDelete: 'cascade' }),
  templateId: integer("templateId").notNull().references(() => emailTemplates.id, { onDelete: 'cascade' }),
  serviceId: integer("serviceId").notNull().references(() => services.id, { onDelete: 'cascade' }),
  status: boolean("status").notNull(),
  sentAt: timestamp("sentAt").notNull().defaultNow(),
});

export const loginAttempts = pgTable("loginAttempts", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull(), // username or email used
  ip: text("ip").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  type: text("type").notNull(), // 'login' or 'reset'
  isp: text("isp"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  user_agent: text("user_agent"), // Browser/device user agent string
});

export const books = pgTable("books", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(), // Original filename
  file_path: text("file_path").notNull(), // Path to stored file
  title: text("title").notNull(),
  author: text("author"),
  description: text("description"),
  publisher: text("publisher"),
  publication_date: text("publication_date"),
  isbn: text("isbn"),
  language: text("language"),
  cover_path: text("cover_path"), // Path to extracted cover image
  file_size: integer("file_size").notNull(), // File size in bytes
  page_count: integer("page_count"),
  uploaded_by: integer("uploaded_by").notNull().references(() => users.id, { onDelete: 'cascade' }),
  uploaded_at: timestamp("uploaded_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const favoriteChannels = pgTable("favoriteChannels", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: text("channelId").notNull(), // IPTV channel ID
  channelName: text("channelName").notNull(),
  channelLogo: text("channelLogo"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

// Subscription system tables
export const subscriptionPlans = pgTable("subscriptionPlans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g., "Basic", "Premium", "Enterprise"
  description: text("description"),
  price_monthly: integer("price_monthly").notNull(), // Price in cents
  price_annual: integer("price_annual").notNull(), // Price in cents
  stripe_price_id_monthly: text("stripe_price_id_monthly"), // Stripe price ID
  stripe_price_id_annual: text("stripe_price_id_annual"), // Stripe price ID
  stripe_product_id: text("stripe_product_id"), // Stripe product ID
  features: jsonb("features").notNull().$type<{
    plex_access: boolean;
    live_tv_access: boolean;
    books_access: boolean;
    game_servers_access: boolean;
    events_access: boolean;
    max_favorite_channels: number;
  }>(), // Feature flags
  is_active: boolean("is_active").notNull().default(true), // Whether plan is available
  sort_order: integer("sort_order").notNull().default(0), // Display order
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const userSubscriptions = pgTable("userSubscriptions", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  plan_id: integer("plan_id").notNull().references(() => subscriptionPlans.id, { onDelete: 'restrict' }),
  stripe_customer_id: text("stripe_customer_id").notNull(),
  stripe_subscription_id: text("stripe_subscription_id").notNull().unique(),
  status: text("status", { enum: ['active', 'canceled', 'past_due', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid'] }).notNull(),
  billing_period: text("billing_period", { enum: ['monthly', 'annual'] }).notNull(),
  current_period_start: timestamp("current_period_start").notNull(),
  current_period_end: timestamp("current_period_end").notNull(),
  cancel_at_period_end: boolean("cancel_at_period_end").notNull().default(false),
  canceled_at: timestamp("canceled_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  subscription_id: integer("subscription_id").references(() => userSubscriptions.id, { onDelete: 'set null' }),
  stripe_invoice_id: text("stripe_invoice_id").notNull().unique(),
  amount: integer("amount").notNull(), // Amount in cents
  status: text("status", { enum: ['paid', 'open', 'void', 'uncollectible', 'draft'] }).notNull(),
  invoice_pdf_url: text("invoice_pdf_url"), // Stripe-hosted PDF URL
  invoice_number: text("invoice_number"),
  billing_period_start: timestamp("billing_period_start"),
  billing_period_end: timestamp("billing_period_end"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const paymentMethods = pgTable("paymentMethods", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  stripe_payment_method_id: text("stripe_payment_method_id").notNull().unique(),
  card_brand: text("card_brand"), // visa, mastercard, amex, etc.
  card_last4: text("card_last4"),
  card_exp_month: integer("card_exp_month"),
  card_exp_year: integer("card_exp_year"),
  is_default: boolean("is_default").notNull().default(false),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

// Referral system tables
export const referralCodes = pgTable("referralCodes", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: text("code").notNull().unique(), // Unique referral code
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrer_user_id: integer("referrer_user_id").notNull().references(() => users.id, { onDelete: 'cascade' }), // User who referred
  referred_user_id: integer("referred_user_id").notNull().references(() => users.id, { onDelete: 'cascade' }), // User who was referred
  referral_code_id: integer("referral_code_id").notNull().references(() => referralCodes.id, { onDelete: 'cascade' }),
  commission_earned: integer("commission_earned").default(0), // Commission in cents
  free_month_credited: boolean("free_month_credited").notNull().default(false),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const referralCredits = pgTable("referralCredits", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  referral_id: integer("referral_id").notNull().references(() => referrals.id, { onDelete: 'cascade' }),
  credit_type: text("credit_type", { enum: ['free_month', 'commission'] }).notNull(),
  amount: integer("amount").notNull(), // For commission (in cents) or 1 for free month
  applied: boolean("applied").notNull().default(false),
  applied_at: timestamp("applied_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

// TV Code Login - Netflix/Hulu style code authentication for TV devices
export const tvCodes = pgTable("tvCodes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  expires_at: timestamp("expires_at").notNull(),
  verified_at: timestamp("verified_at"),
  verified_by_user_id: integer("verified_by_user_id").references(() => users.id),
  auth_token: text("auth_token"),
  used: boolean("used").notNull().default(false),
});

// IPTV Providers - Top-level provider definitions
export const iptvProviders = pgTable("iptv_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // Display name (e.g., "Provider X")
  providerType: text("provider_type", { enum: ['xtream', 'm3u'] }).notNull().default('xtream'), // Provider type
  serverUrl: text("server_url"), // Encrypted - Base URL for Xtream providers (nullable for M3U)
  m3uUrl: text("m3u_url"), // M3U playlist URL (for M3U providers)
  xmltvUrl: text("xmltv_url"), // XMLTV EPG URL (for M3U providers)
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"), // Admin notes
  lastChannelSync: timestamp("last_channel_sync"), // When channels were last synced
  healthStatus: text("health_status", { enum: ['healthy', 'unhealthy', 'degraded', 'unknown'] }).notNull().default('unknown'),
  lastHealthCheck: timestamp("last_health_check"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// IPTV Credentials - Multiple logins per provider (encrypted at rest)
export const iptvCredentials = pgTable("iptv_credentials", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => iptvProviders.id, { onDelete: 'cascade' }), // Link to provider (nullable for migration)
  name: text("name").notNull(), // Display name (e.g., "Login 1", "Login 2")
  serverUrl: text("server_url"), // Encrypted - DEPRECATED, use provider.serverUrl (nullable for migration)
  username: text("username").notNull(), // Encrypted
  password: text("password").notNull(), // Encrypted
  maxConnections: integer("max_connections").notNull().default(1), // Max concurrent streams for this credential
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"), // Admin notes
  healthStatus: text("health_status", { enum: ['healthy', 'unhealthy', 'unknown'] }).notNull().default('unknown'),
  lastHealthCheck: timestamp("last_health_check"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// IPTV Channels - All channels from a provider (synced from provider)
export const iptvChannels = pgTable("iptv_channels", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => iptvProviders.id, { onDelete: 'cascade' }),
  streamId: text("stream_id").notNull(), // Provider's channel/stream ID
  name: text("name").notNull(),
  logo: text("logo"), // Channel logo URL from provider
  customLogo: text("custom_logo"), // Admin-set custom logo URL (overrides provider logo)
  categoryId: text("category_id"), // Provider's category ID
  categoryName: text("category_name"), // Category display name
  epgChannelId: text("epg_channel_id"), // XMLTV channel ID for EPG lookup
  directStreamUrl: text("direct_stream_url"), // Direct stream URL (for M3U providers)
  isEnabled: boolean("is_enabled").notNull().default(false), // Admin enables channels for use
  quality: text("quality", { enum: ['4k', 'hd', 'sd', 'unknown'] }).default('unknown'), // Stream quality
  hasEPG: boolean("has_epg").notNull().default(false), // Whether channel has EPG data
  lastSeen: timestamp("last_seen"), // Last time channel was seen in provider sync
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Channel Packages - Groups of channels (tied to a provider)
export const channelPackages = pgTable("channel_packages", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => iptvProviders.id, { onDelete: 'cascade' }),
  name: text("name").notNull(), // Package name (e.g., "US Sports", "International")
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Package Channels - Channels assigned to packages (many-to-many)
export const packageChannels = pgTable("package_channels", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => channelPackages.id, { onDelete: 'cascade' }),
  channelId: integer("channel_id").notNull().references(() => iptvChannels.id, { onDelete: 'cascade' }),
  sortOrder: integer("sort_order").notNull().default(0), // Order within package
});

// Plan Packages - Packages assigned to subscription plans (many-to-many)
export const planPackages = pgTable("plan_packages", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => subscriptionPlans.id, { onDelete: 'cascade' }),
  packageId: integer("package_id").notNull().references(() => channelPackages.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Plan-Credential Junction - DEPRECATED: Use planPackages instead
// Kept for backwards compatibility during migration
export const planIptvCredentials = pgTable("plan_iptv_credentials", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => subscriptionPlans.id, { onDelete: 'cascade' }),
  credentialId: integer("credential_id").notNull().references(() => iptvCredentials.id, { onDelete: 'cascade' }),
  priority: integer("priority").notNull().default(0), // Lower = higher priority for load balancing
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Active IPTV Streams - Track concurrent streams per credential for rate limiting
export const activeIptvStreams = pgTable("active_iptv_streams", {
  id: serial("id").primaryKey(),
  credentialId: integer("credential_id").notNull().references(() => iptvCredentials.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  streamId: text("stream_id").notNull(), // IPTV channel/stream ID
  sessionToken: text("session_token").notNull().unique(), // Unique session identifier
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastHeartbeat: timestamp("last_heartbeat").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  deviceType: text("device_type"), // 'ios', 'web', 'android'
  startProgramTitle: text("start_program_title"), // Program playing when stream started
});

// Viewing History - Persistent record of all watch sessions for analytics
export const viewingHistory = pgTable("viewing_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: text("channel_id").notNull(), // IPTV channel/stream ID
  channelName: text("channel_name"), // Denormalized for easy display
  programTitle: text("program_title"), // Program playing at START of session
  endProgramTitle: text("end_program_title"), // Program playing at END of session (if different)
  credentialId: integer("credential_id").references(() => iptvCredentials.id, { onDelete: 'set null' }),
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at"),
  durationSeconds: integer("duration_seconds"), // Calculated when stream ends
  ipAddress: text("ip_address"),
  deviceType: text("device_type"), // 'ios', 'web', 'android'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Channel Mappings - Cross-provider channel equivalence for failover
export const channelMappings = pgTable("channel_mappings", {
  id: serial("id").primaryKey(),
  primaryChannelId: integer("primary_channel_id").notNull().references(() => iptvChannels.id, { onDelete: 'cascade' }),
  backupChannelId: integer("backup_channel_id").notNull().references(() => iptvChannels.id, { onDelete: 'cascade' }),
  priority: integer("priority").notNull().default(1), // Lower number = higher priority (1 is first backup)
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Provider Health Logs - Historical health tracking for monitoring
export const providerHealthLogs = pgTable("provider_health_logs", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => iptvProviders.id, { onDelete: 'cascade' }),
  status: text("status", { enum: ['healthy', 'unhealthy', 'degraded'] }).notNull(),
  responseTimeMs: integer("response_time_ms"), // NULL if unhealthy (timeout/error)
  errorMessage: text("error_message"), // Error details if unhealthy
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users);
export const insertServiceSchema = createInsertSchema(services);
export const insertGameServerSchema = createInsertSchema(gameServers);
export const insertSettingsSchema = createInsertSchema(settings);
export const insertServiceStatusLogSchema = createInsertSchema(serviceStatusLogs);
export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences);
export const insertEmailTemplateSchema = createInsertSchema(emailTemplates);
export const insertSentNotificationSchema = createInsertSchema(sentNotifications);
export const insertLoginAttemptSchema = createInsertSchema(loginAttempts);
export const insertBookSchema = createInsertSchema(books);
export const insertFavoriteChannelSchema = createInsertSchema(favoriteChannels);
export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlans);
export const insertUserSubscriptionSchema = createInsertSchema(userSubscriptions);
export const insertInvoiceSchema = createInsertSchema(invoices);
export const insertPaymentMethodSchema = createInsertSchema(paymentMethods);
export const insertReferralCodeSchema = createInsertSchema(referralCodes);
export const insertReferralSchema = createInsertSchema(referrals);
export const insertReferralCreditSchema = createInsertSchema(referralCredits);
export const insertTvCodeSchema = createInsertSchema(tvCodes);
export const insertIptvProviderSchema = createInsertSchema(iptvProviders);
export const insertIptvCredentialSchema = createInsertSchema(iptvCredentials);
export const insertIptvChannelSchema = createInsertSchema(iptvChannels);
export const insertChannelPackageSchema = createInsertSchema(channelPackages);
export const insertPackageChannelSchema = createInsertSchema(packageChannels);
export const insertPlanPackageSchema = createInsertSchema(planPackages);
export const insertPlanIptvCredentialSchema = createInsertSchema(planIptvCredentials);
export const insertActiveIptvStreamSchema = createInsertSchema(activeIptvStreams);
export const insertViewingHistorySchema = createInsertSchema(viewingHistory);
export const insertChannelMappingSchema = createInsertSchema(channelMappings);
export const insertProviderHealthLogSchema = createInsertSchema(providerHealthLogs);

// Export the update schemas
export const updateServiceSchema = insertServiceSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateGameServerSchema = insertGameServerSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateUserSchema = insertUserSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateSettingsSchema = insertSettingsSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateNotificationPreferenceSchema = insertNotificationPreferenceSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateEmailTemplateSchema = insertEmailTemplateSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateLoginAttemptSchema = insertLoginAttemptSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateBookSchema = insertBookSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateSubscriptionPlanSchema = insertSubscriptionPlanSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateUserSubscriptionSchema = insertUserSubscriptionSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateInvoiceSchema = insertInvoiceSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updatePaymentMethodSchema = insertPaymentMethodSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateReferralCodeSchema = insertReferralCodeSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateReferralSchema = insertReferralSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateReferralCreditSchema = insertReferralCreditSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateIptvCredentialSchema = insertIptvCredentialSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updatePlanIptvCredentialSchema = insertPlanIptvCredentialSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateActiveIptvStreamSchema = insertActiveIptvStreamSchema.extend({
  id: z.number(),
}).partial().required({ id: true });

export const updateViewingHistorySchema = insertViewingHistorySchema.extend({
  id: z.number(),
}).partial().required({ id: true });

// Export types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertService = z.infer<typeof insertServiceSchema>;
export type InsertGameServer = z.infer<typeof insertGameServerSchema>;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type UpdateService = z.infer<typeof updateServiceSchema>;
export type UpdateGameServer = z.infer<typeof updateGameServerSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
export type User = typeof users.$inferSelect;
export type Service = typeof services.$inferSelect;
export type GameServer = typeof gameServers.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type ServiceStatusLog = typeof serviceStatusLogs.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type SentNotification = typeof sentNotifications.$inferSelect;
export type InsertLoginAttempt = z.infer<typeof insertLoginAttemptSchema>;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type InsertBook = z.infer<typeof insertBookSchema>;
export type UpdateBook = z.infer<typeof updateBookSchema>;
export type Book = typeof books.$inferSelect;
export type InsertFavoriteChannel = z.infer<typeof insertFavoriteChannelSchema>;
export type FavoriteChannel = typeof favoriteChannels.$inferSelect;
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type UpdateSubscriptionPlan = z.infer<typeof updateSubscriptionPlanSchema>;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertUserSubscription = z.infer<typeof insertUserSubscriptionSchema>;
export type UpdateUserSubscription = z.infer<typeof updateUserSubscriptionSchema>;
export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertPaymentMethod = z.infer<typeof insertPaymentMethodSchema>;
export type UpdatePaymentMethod = z.infer<typeof updatePaymentMethodSchema>;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type InsertReferralCode = z.infer<typeof insertReferralCodeSchema>;
export type UpdateReferralCode = z.infer<typeof updateReferralCodeSchema>;
export type ReferralCode = typeof referralCodes.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type UpdateReferral = z.infer<typeof updateReferralSchema>;
export type Referral = typeof referrals.$inferSelect;
export type InsertReferralCredit = z.infer<typeof insertReferralCreditSchema>;
export type UpdateReferralCredit = z.infer<typeof updateReferralCreditSchema>;
export type ReferralCredit = typeof referralCredits.$inferSelect;
export type InsertTvCode = z.infer<typeof insertTvCodeSchema>;
export type TvCode = typeof tvCodes.$inferSelect;
export type InsertIptvCredential = z.infer<typeof insertIptvCredentialSchema>;
export type UpdateIptvCredential = z.infer<typeof updateIptvCredentialSchema>;
export type IptvCredential = typeof iptvCredentials.$inferSelect;
export type InsertPlanIptvCredential = z.infer<typeof insertPlanIptvCredentialSchema>;
export type UpdatePlanIptvCredential = z.infer<typeof updatePlanIptvCredentialSchema>;
export type PlanIptvCredential = typeof planIptvCredentials.$inferSelect;
export type InsertActiveIptvStream = z.infer<typeof insertActiveIptvStreamSchema>;
export type UpdateActiveIptvStream = z.infer<typeof updateActiveIptvStreamSchema>;
export type ActiveIptvStream = typeof activeIptvStreams.$inferSelect;
export type InsertViewingHistory = z.infer<typeof insertViewingHistorySchema>;
export type UpdateViewingHistory = z.infer<typeof updateViewingHistorySchema>;
export type ViewingHistory = typeof viewingHistory.$inferSelect;