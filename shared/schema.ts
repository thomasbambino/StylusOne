import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
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
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  default_role: text("default_role", { enum: ['admin', 'user', 'pending'] }).notNull().default('pending'),
  site_title: text("site_title").default("Homelab Dashboard"),
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

export const insertUserSchema = createInsertSchema(users);
export const insertServiceSchema = createInsertSchema(services);
export const insertGameServerSchema = createInsertSchema(gameServers);
export const insertSettingsSchema = createInsertSchema(settings);
export const insertServiceStatusLogSchema = createInsertSchema(serviceStatusLogs);
export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences);
export const insertEmailTemplateSchema = createInsertSchema(emailTemplates);
export const insertSentNotificationSchema = createInsertSchema(sentNotifications);
export const insertLoginAttemptSchema = createInsertSchema(loginAttempts);

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