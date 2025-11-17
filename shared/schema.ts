import { pgTable, text, serial, integer, boolean, timestamp, jsonb, decimal } from "drizzle-orm/pg-core";
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