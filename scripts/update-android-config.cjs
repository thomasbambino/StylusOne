#!/usr/bin/env node

/**
 * Auto-inject Google Client ID from .env into Android strings.xml
 *
 * This script reads VITE_GOOGLE_CLIENT_ID from the .env file and injects it
 * into android/app/src/main/res/values/strings.xml automatically.
 *
 * Run this before Capacitor sync to keep configuration in sync.
 */

const fs = require('fs');
const path = require('path');

// Paths
const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const stringsXmlPath = path.join(rootDir, 'android/app/src/main/res/values/strings.xml');

// Read .env file
function readEnvFile() {
  try {
    if (!fs.existsSync(envPath)) {
      console.warn('⚠️  Warning: .env file not found. Skipping Android config update.');
      return null;
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    const env = {};

    for (const line of lines) {
      // Skip comments and empty lines
      if (line.trim().startsWith('#') || !line.trim()) continue;

      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }

    return env;
  } catch (error) {
    console.error('❌ Error reading .env file:', error.message);
    return null;
  }
}

// Update strings.xml
function updateStringsXml(clientId) {
  try {
    if (!fs.existsSync(stringsXmlPath)) {
      console.error('❌ Error: strings.xml not found at:', stringsXmlPath);
      console.error('   Make sure you have run "npx cap add android" first.');
      process.exit(1);
    }

    let stringsXml = fs.readFileSync(stringsXmlPath, 'utf8');

    // Check if server_client_id exists
    const serverClientIdRegex = /<string name="server_client_id">.*?<\/string>/;

    if (serverClientIdRegex.test(stringsXml)) {
      // Replace existing value
      stringsXml = stringsXml.replace(
        serverClientIdRegex,
        `<string name="server_client_id">${clientId}</string>`
      );
      console.log('✅ Updated server_client_id in strings.xml');
    } else {
      // Add before closing </resources> tag
      stringsXml = stringsXml.replace(
        '</resources>',
        `    <!-- Google OAuth Client ID - Auto-injected from .env -->\n    <string name="server_client_id">${clientId}</string>\n</resources>`
      );
      console.log('✅ Added server_client_id to strings.xml');
    }

    fs.writeFileSync(stringsXmlPath, stringsXml, 'utf8');
    console.log(`📱 Android config updated with Google Client ID`);
  } catch (error) {
    console.error('❌ Error updating strings.xml:', error.message);
    process.exit(1);
  }
}

// Main
function main() {
  console.log('🔧 Updating Android configuration from .env...');

  const env = readEnvFile();
  if (!env) {
    process.exit(0); // Exit gracefully if .env doesn't exist
  }

  const clientId = env.VITE_GOOGLE_CLIENT_ID;

  if (!clientId) {
    console.warn('⚠️  Warning: VITE_GOOGLE_CLIENT_ID not found in .env');
    console.warn('   Google Sign-In on Android may not work.');
    console.warn('   Set VITE_GOOGLE_CLIENT_ID in your .env file.');
    process.exit(0); // Exit gracefully, don't fail the build
  }

  updateStringsXml(clientId);
}

main();
