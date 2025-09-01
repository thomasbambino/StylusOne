// Standalone database connection for admin user creation
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgTable, text, serial, boolean, timestamp, integer } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';

// Define minimal users table schema
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  role: text("role", { enum: ['superadmin', 'admin', 'user', 'pending'] }).notNull().default('pending'),
  enabled: boolean("enabled").notNull().default(true),
  approved: boolean("approved").notNull().default(false),
});

// Create database connection
const client = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  max_lifetime: 60 * 30
});

export const db = drizzle(client);
export { eq };