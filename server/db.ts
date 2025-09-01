import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Use postgres-js for local PostgreSQL connections
const client = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  max_lifetime: 60 * 30
});

export const db = drizzle(client, { schema });

// Export client as pool for backward compatibility with raw queries
export const pool = client;
