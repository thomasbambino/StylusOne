import {
  Service,
  GameServer,
  User,
  InsertUser,
  InsertService,
  InsertGameServer,
  UpdateService,
  UpdateGameServer,
  UpdateUser,
  users,
  services,
  gameServers,
  settings as settingsTable,
  Settings,
  InsertSettings,
  UpdateSettings,
  serviceStatusLogs,
  ServiceStatusLog,
  notificationPreferences,
  emailTemplates,
  sentNotifications,
  NotificationPreference,
  EmailTemplate,
  SentNotification,
  InsertNotificationPreference,
  InsertEmailTemplate,
  InsertSentNotification,
  UpdateNotificationPreference,
  UpdateEmailTemplate,
  loginAttempts,
  LoginAttempt,
  InsertLoginAttempt,
} from "../shared/schema.js";
import { db, pool } from "./db.js";
import { eq, desc, and, gte, lte, or, asc } from "drizzle-orm";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(user: UpdateUser): Promise<User | undefined>;
  getAllServices(): Promise<Service[]>;
  getAllGameServers(): Promise<GameServer[]>;
  createService(service: InsertService): Promise<Service>;
  createGameServer(server: InsertGameServer): Promise<GameServer>;
  updateService(service: UpdateService): Promise<Service | undefined>;
  updateGameServer(server: UpdateGameServer): Promise<GameServer | undefined>;
  deleteService(id: number): Promise<Service | undefined>;
  deleteGameServer(id: number): Promise<GameServer | undefined>;
  getSettings(): Promise<Settings>;
  updateSettings(settings: UpdateSettings): Promise<Settings>;
  sessionStore: session.Store;
  createServiceStatusLog(serviceId: number, status: boolean, responseTime?: number): Promise<ServiceStatusLog>;
  getServiceStatusLogs(filters?: {
    serviceId?: number;
    startDate?: Date;
    endDate?: Date;
    status?: boolean;
  }): Promise<ServiceStatusLog[]>;
  getService(id: number): Promise<Service | undefined>;

  // Notification Preferences
  getNotificationPreference(userId: number, serviceId: number): Promise<NotificationPreference | undefined>;
  getUserNotificationPreferences(userId: number): Promise<NotificationPreference[]>;
  createNotificationPreference(preference: InsertNotificationPreference): Promise<NotificationPreference>;
  updateNotificationPreference(preference: UpdateNotificationPreference): Promise<NotificationPreference | undefined>;
  deleteNotificationPreference(id: number): Promise<NotificationPreference | undefined>;

  // Email Templates
  getEmailTemplate(id: number): Promise<EmailTemplate | undefined>;
  getDefaultEmailTemplate(): Promise<EmailTemplate | undefined>;
  getAllEmailTemplates(): Promise<EmailTemplate[]>;
  createEmailTemplate(template: InsertEmailTemplate): Promise<EmailTemplate>;
  updateEmailTemplate(template: UpdateEmailTemplate): Promise<EmailTemplate | undefined>;
  getEmailTemplateByName(name: string): Promise<EmailTemplate | undefined>;

  // Sent Notifications
  createSentNotification(notification: InsertSentNotification): Promise<SentNotification>;
  getRecentSentNotifications(serviceId: number): Promise<SentNotification[]>;

  // Add new methods for login attempts
  getLoginAttemptsInWindow(identifier: string, ip: string, type: string, windowMs: number): Promise<number>;
  addLoginAttempt(attempt: InsertLoginAttempt): Promise<LoginAttempt>;
  clearLoginAttempts(identifier: string, ip: string, type: string): Promise<void>;
  getOldestLoginAttempt(identifier: string, ip: string, type: string): Promise<LoginAttempt | undefined>;

  // Add new method for getting game server by instanceId
  getGameServerByInstanceId(instanceId: string): Promise<GameServer | undefined>;
  getGameServer(id: number): Promise<GameServer | undefined>;
  deleteUser(id: number): Promise<User | undefined>;
  getAllLoginAttempts(): Promise<LoginAttempt[]>;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    // Use PostgreSQL session store for production
    const PgStore = connectPgSimple(session);
    this.sessionStore = new PgStore({
      pool: pool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.reset_token, token));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [settings] = await db.select().from(settingsTable);
    const [user] = await db.insert(users).values({
      ...insertUser,
      role: insertUser.role ?? settings?.default_role ?? 'pending',
      approved: insertUser.approved ?? (settings?.default_role === 'pending' ? false : true),
    }).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    // First get all login attempts with latest timestamp for each user
    const latestAttempts = await db
      .select({
        identifier: loginAttempts.identifier,
        ip: loginAttempts.ip,
        timestamp: loginAttempts.timestamp,
        type: loginAttempts.type
      })
      .from(loginAttempts)
      .where(eq(loginAttempts.type, 'success'))
      .orderBy(desc(loginAttempts.timestamp));

    // Get all users
    const allUsers = await db.select().from(users);

    // Map the latest IP and timestamp to each user
    return allUsers.map((user: User) => {
      // Make case-insensitive comparison for both username and email
      const latestAttempt = latestAttempts.find(
        (attempt: { identifier: string; ip: string; timestamp: Date; type: string }) => {
          // Compare case-insensitively
          const attemptId = attempt.identifier.toLowerCase();
          const username = user.username.toLowerCase();
          const email = user.email ? user.email.toLowerCase() : '';
          
          return attemptId === username || attemptId === email;
        }
      );
      return {
        ...user,
        last_ip: latestAttempt?.ip || user.last_ip,
        last_login: latestAttempt?.timestamp || user.last_login
      };
    });
  }

  async updateUser(user: UpdateUser): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set(user)
      .where(eq(users.id, user.id))
      .returning();
    return updatedUser;
  }

  async getAllServices(): Promise<Service[]> {
    return await db.select().from(services);
  }

  async getAllGameServers(): Promise<GameServer[]> {
    return await db.select().from(gameServers);
  }

  async createService(service: InsertService): Promise<Service> {
    const [newService] = await db.insert(services).values(service).returning();
    return newService;
  }

  async createGameServer(server: InsertGameServer): Promise<GameServer> {
    const [newServer] = await db
      .insert(gameServers)
      .values({
        ...server,
        lastStatusCheck: new Date()
      })
      .returning();
    return newServer;
  }

  async updateService(service: UpdateService): Promise<Service | undefined> {
    const [updatedService] = await db
      .update(services)
      .set(service)
      .where(eq(services.id, service.id))
      .returning();
    return updatedService;
  }

  async updateGameServer(server: UpdateGameServer): Promise<GameServer | undefined> {
    console.log('STORAGE: updateGameServer called with data:', JSON.stringify(server));
    
    // For icon updates, try a different approach due to potential conflicts
    if (server.icon) {
      console.log('STORAGE: Icon update detected, using special handling');
      try {
        // Try the ORM approach first
        const [updatedServer] = await db
          .update(gameServers)
          .set({
            ...server,
            lastStatusCheck: new Date()
          })
          .where(eq(gameServers.id, server.id))
          .returning();
        
        console.log('STORAGE: Icon update succeeded with ORM, returning:', JSON.stringify(updatedServer));
        return updatedServer;
      } catch (ormError) {
        console.error('STORAGE: ORM update failed for icon, trying direct SQL:', ormError);
        
        // On ORM failure, try direct SQL
        try {
          // Create a prepared statement to update just the icon
          const sqlQuery = `
            UPDATE "gameServers" 
            SET "icon" = $1, "lastStatusCheck" = $2 
            WHERE "id" = $3 
            RETURNING *
          `;
          
          console.log('STORAGE: Executing direct SQL with values:', [server.icon, new Date(), server.id]);
          const result = await pool.query(sqlQuery, [server.icon, new Date(), server.id]);
          
          if (result.rows && result.rows.length > 0) {
            console.log('STORAGE: Direct SQL icon update succeeded, returning:', JSON.stringify(result.rows[0]));
            return result.rows[0] as GameServer;
          } else {
            console.error('STORAGE: Direct SQL returned no rows');
            throw new Error('No rows returned from direct SQL update');
          }
        } catch (sqlError) {
          console.error('STORAGE: Even direct SQL update failed:', sqlError);
          if (sqlError instanceof Error) {
            console.error('STORAGE: SQL error stack:', sqlError.stack);
            
            // Look for specific error patterns
            if (sqlError.message.includes('duplicate key')) {
              console.error('STORAGE: Primary key conflict detected');
            }
          }
          
          // If all else fails, throw the original ORM error for consistency
          throw ormError;
        }
      }
    } else {
      // For non-icon updates, use the standard approach
      try {
        const [updatedServer] = await db
          .update(gameServers)
          .set({
            ...server,
            lastStatusCheck: new Date()
          })
          .where(eq(gameServers.id, server.id))
          .returning();
        
        console.log('STORAGE: Standard update succeeded, returning:', JSON.stringify(updatedServer));
        return updatedServer;
      } catch (error) {
        console.error('STORAGE: updateGameServer FAILED with error:', error);
        if (error instanceof Error) {
          console.error('STORAGE: error stack:', error.stack);
        }
        throw error;
      }
    }
  }

  async deleteService(id: number): Promise<Service | undefined> {
    const [deletedService] = await db
      .delete(services)
      .where(eq(services.id, id))
      .returning();
    return deletedService;
  }

  async deleteGameServer(id: number): Promise<GameServer | undefined> {
    const [deletedServer] = await db
      .delete(gameServers)
      .where(eq(gameServers.id, id))
      .returning();
    return deletedServer;
  }

  async getSettings(): Promise<Settings> {
    const [existingSettings] = await db.select().from(settingsTable);
    if (!existingSettings) {
      // Create default settings if none exist
      const [newSettings] = await db.insert(settingsTable).values({}).returning();
      return newSettings;
    }
    return existingSettings;
  }

  async updateSettings(settingsData: UpdateSettings): Promise<Settings> {
    const settings = await this.getSettings();

    // Ensure we have a valid settings record
    if (!settings) {
      throw new Error("Settings not found");
    }

    // Perform the update with proper type handling
    const [updatedSettings] = await db
      .update(settingsTable)
      .set(settingsData)
      .where(eq(settingsTable.id, settingsData.id))
      .returning();

    return updatedSettings;
  }

  // Disabled to reduce database usage - no longer logging service status changes
  async createServiceStatusLog(serviceId: number, status: boolean, responseTime?: number): Promise<ServiceStatusLog> {
    // Create a dummy log object without inserting into database
    return {
      id: 0,
      serviceId: serviceId,
      status: status,
      responseTime: responseTime || 0,
      timestamp: new Date()
    } as ServiceStatusLog;
  }

  // Disabled to reduce database usage - no longer retrieving historical service status logs
  async getServiceStatusLogs(filters?: {
    serviceId?: number;
    startDate?: Date;
    endDate?: Date;
    status?: boolean;
  }): Promise<ServiceStatusLog[]> {
    // Return empty array instead of querying database
    return [];
  }

  async getService(id: number): Promise<Service | undefined> {
    const [service] = await db.select().from(services).where(eq(services.id, id));
    return service;
  }

  // Notification Preferences
  async getNotificationPreference(userId: number, serviceId: number): Promise<NotificationPreference | undefined> {
    const [preference] = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.serviceId, serviceId)
        )
      );
    return preference;
  }

  async getUserNotificationPreferences(userId: number): Promise<NotificationPreference[]> {
    return await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
  }

  async createNotificationPreference(preference: InsertNotificationPreference): Promise<NotificationPreference> {
    const [newPreference] = await db
      .insert(notificationPreferences)
      .values(preference)
      .returning();
    return newPreference;
  }

  async updateNotificationPreference(preference: UpdateNotificationPreference): Promise<NotificationPreference | undefined> {
    const [updatedPreference] = await db
      .update(notificationPreferences)
      .set(preference)
      .where(eq(notificationPreferences.id, preference.id))
      .returning();
    return updatedPreference;
  }

  async deleteNotificationPreference(id: number): Promise<NotificationPreference | undefined> {
    const [deletedPreference] = await db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.id, id))
      .returning();
    return deletedPreference;
  }

  // Email Templates
  async getEmailTemplate(id: number): Promise<EmailTemplate | undefined> {
    const [template] = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.id, id));
    return template;
  }

  async getDefaultEmailTemplate(): Promise<EmailTemplate | undefined> {
    const [template] = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.defaultTemplate, true));
    return template;
  }

  async getAllEmailTemplates(): Promise<EmailTemplate[]> {
    return await db.select().from(emailTemplates);
  }

  async createEmailTemplate(template: InsertEmailTemplate): Promise<EmailTemplate> {
    const [newTemplate] = await db
      .insert(emailTemplates)
      .values(template)
      .returning();
    return newTemplate;
  }

  async updateEmailTemplate(template: UpdateEmailTemplate): Promise<EmailTemplate | undefined> {
    const [updatedTemplate] = await db
      .update(emailTemplates)
      .set(template)
      .where(eq(emailTemplates.id, template.id))
      .returning();
    return updatedTemplate;
  }

  async getEmailTemplateByName(name: string): Promise<EmailTemplate | undefined> {
    const [template] = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.name, name));
    return template;
  }

  // Sent Notifications
  async createSentNotification(notification: InsertSentNotification): Promise<SentNotification> {
    const [newNotification] = await db
      .insert(sentNotifications)
      .values(notification)
      .returning();
    return newNotification;
  }

  async getRecentSentNotifications(serviceId: number): Promise<SentNotification[]> {
    return await db
      .select()
      .from(sentNotifications)
      .where(eq(sentNotifications.serviceId, serviceId))
      .orderBy(desc(sentNotifications.sentAt))
      .limit(10);
  }

  // Login Attempts
  async getLoginAttemptsInWindow(identifier: string, ip: string, type: string, windowMs: number): Promise<number> {
    const windowStart = new Date(Date.now() - windowMs);
    const attempts = await db
      .select()
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.identifier, identifier),
          eq(loginAttempts.ip, ip),
          eq(loginAttempts.type, type),
          gte(loginAttempts.timestamp, windowStart)
        )
      );
    return attempts.length;
  }

  async addLoginAttempt(attempt: InsertLoginAttempt): Promise<LoginAttempt> {
    const [newAttempt] = await db
      .insert(loginAttempts)
      .values(attempt)
      .returning();
    return newAttempt;
  }

  async clearLoginAttempts(identifier: string, ip: string, type: string): Promise<void> {
    await db
      .delete(loginAttempts)
      .where(
        and(
          eq(loginAttempts.identifier, identifier),
          eq(loginAttempts.ip, ip),
          eq(loginAttempts.type, type)
        )
      );
  }

  async getOldestLoginAttempt(identifier: string, ip: string, type: string): Promise<LoginAttempt | undefined> {
    const [attempt] = await db
      .select()
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.identifier, identifier),
          eq(loginAttempts.ip, ip),
          eq(loginAttempts.type, type)
        )
      )
      .orderBy(asc(loginAttempts.timestamp))
      .limit(1);
    return attempt;
  }

  async getGameServerByInstanceId(instanceId: string): Promise<GameServer | undefined> {
    const [server] = await db
      .select()
      .from(gameServers)
      .where(eq(gameServers.instanceId, instanceId));
    return server;
  }

  async getGameServer(id: number): Promise<GameServer | undefined> {
    const [server] = await db
      .select()
      .from(gameServers)
      .where(eq(gameServers.id, id));
    return server;
  }

  async deleteUser(id: number): Promise<User | undefined> {
    const [deletedUser] = await db
      .delete(users)
      .where(eq(users.id, id))
      .returning();
    return deletedUser;
  }

  async getAllLoginAttempts(): Promise<LoginAttempt[]> {
    return await db
      .select()
      .from(loginAttempts)
      .orderBy(desc(loginAttempts.timestamp));
  }
}

export const storage = new DatabaseStorage();