#!/usr/bin/env node

// Non-interactive admin user creation script for Docker
// Can be run with environment variables or command line arguments

import { randomBytes } from 'crypto';
import { scrypt } from 'crypto';
import { promisify } from 'util';
import { writeFileSync } from 'fs';

const scryptAsync = promisify(scrypt);

// Import database after setting up environment
async function createAdminUser() {
    try {
        // Dynamic import to handle ESM modules  
        const { db, users, eq } = await import('./db-connection.js');

        // Get admin details from environment or command line
        const username = process.env.ADMIN_USERNAME || process.argv[2] || 'admin';
        const email = process.env.ADMIN_EMAIL || process.argv[3] || 'admin@localhost';
        const password = process.env.ADMIN_PASSWORD || process.argv[4] || 'admin123';

        console.log('🔍 Checking if admin user needs to be created...');

        // Check if any users exist
        const existingUsers = await db.select().from(users).limit(1);
        
        if (existingUsers.length > 0) {
            console.log('✅ Users already exist in the system. Admin user creation skipped.');
            return;
        }

        console.log('👤 Creating admin user...');

        // Hash the password
        const salt = randomBytes(16).toString('hex');
        const buf = await scryptAsync(password, salt, 32);
        const hashedPassword = `${buf.toString('hex')}.${salt}`;

        // Create the admin user
        const [newUser] = await db.insert(users).values({
            username: username,
            email: email,
            password: hashedPassword,
            approved: true,
            enabled: true,
            role: 'superadmin',
        }).returning();

        console.log('🎉 Super admin user created successfully!');
        console.log(`   👤 Username: ${newUser.username}`);
        console.log(`   📧 Email: ${newUser.email}`);
        console.log(`   🔑 Password: ${password}`);
        console.log('');
        console.log('🚀 You can now log in to the dashboard with these credentials.');

        // Create setup complete flag
        writeFileSync('/app/.setup-complete', new Date().toISOString());

    } catch (error) {
        console.error('❌ Error creating admin user:', error.message);
        
        // If it's a database connection error, provide helpful message
        if (error.message.includes('connect') || error.message.includes('ECONNREFUSED')) {
            console.log('💡 This might be a database connectivity issue.');
            console.log('   The system will try again when the database is ready.');
        }
        
        process.exit(1);
    }
}

// Handle ESM execution
if (import.meta.url === `file://${process.argv[1]}`) {
    createAdminUser().catch(console.error);
}