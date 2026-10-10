#!/usr/bin/env node

/**
 * Script to create an admin user
 * Usage: node scripts/create-admin.js --username admin --password yourpassword
 * 
 * If no password is provided, a random one will be generated and displayed
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { db } = require('../src/database/db');
const crypto = require('crypto');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.findIndex(arg => arg === `--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
};

const username = getArg('username');
let password = getArg('password');

if (!username || !/^[\p{L}\p{N}_-]{3,50}$/u.test(username)) {
  console.error('Error: Provide a username of 3–50 letters, numbers, underscores or hyphens with --username.');
  process.exit(1);
}

// Generate password if not provided
if (!password) {
  password = crypto.randomBytes(12).toString('base64').slice(0, 16);
  console.log(`Generated password: ${password}`);
  console.log('Please save this password securely!');
}

async function createAdmin() {
  try {
    // Check if user already exists
    const existingUser = await db('admin_users')
      .where('username', username)
      .first();

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    if (existingUser) {
      // Update existing user's password
      await db('admin_users')
        .where('id', existingUser.id)
        .update({
          password_hash: passwordHash,
          updated_at: new Date()
        });

      console.log(`✅ Admin user updated successfully!`);
      console.log(`   Username: ${existingUser.username}`);
      console.log(`   Password has been reset to the provided value`);
      console.log(`   Login URL: ${process.env.ADMIN_URL || 'http://localhost:3000'}/admin/login`);
    } else {
      // Create new admin user
      await db('admin_users').insert({
        username,
        // Older databases retain a required email column for compatibility;
        // the placeholder cannot receive mail and is never used for login.
        email: `${crypto.randomUUID()}@accounts.invalid`,
        password_hash: passwordHash,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      console.log(`✅ Admin user created successfully!`);
      console.log(`   Username: ${username}`);
      console.log(`   Login URL: ${process.env.ADMIN_URL || 'http://localhost:3000'}/admin/login`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error.message);
    process.exit(1);
  }
}

createAdmin();
