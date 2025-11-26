// createSuperAdmin.js
require("dotenv").config(); // Load .env vars
const pool = require("./db"); // Adjust path if needed
const bcrypt = require("bcrypt");

// User details
const username = "rickytorres";
const name = "Ricky Torres";
const email = "Info@twentytwohealth.com";
const passwordPlain = "RPM$2025!";
const roleType = "super-admin";

// Salt rounds for bcrypt (adjust as needed for security)
const saltRounds = 10;

async function createSuperAdmin() {
  let connection;
  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(passwordPlain, saltRounds);
    console.log("Password hashed successfully.");

    // Get a connection from the pool
    connection = await pool.getConnection();

    // Insert into users table
    const userInsertQuery = `
      INSERT INTO users (username, name, email, password, created_at, updated_at, is_active, last_login, phoneNumber, organization_id)
      VALUES (?, ?, ?, ?, NOW(), NOW(), ?, NULL, ?, NULL)
    `;
    const userInsertResult = await connection.execute(userInsertQuery, [
      username,
      name,
      email,
      hashedPassword,
      1, // is_active = true
      null, // phoneNumber
    ]);
    const userId = userInsertResult[0].insertId;
    console.log(`User created with ID: ${userId}`);

    // Insert into role table
    const roleInsertQuery = `
      INSERT INTO role (username, user_id, role_type, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
    `;
    await connection.execute(roleInsertQuery, [username, userId, roleType]);
    console.log("Role 'super-admin' assigned successfully.");
  } catch (error) {
    console.error("Error creating super admin:", error);
    if (error.code === "ER_ACCESS_DENIED_ERROR") {
      console.error(
        "Tip: Double-check your .env file credentials and ensure the MySQL user has INSERT privileges on the tables."
      );
    }
  } finally {
    if (connection) {
      connection.release();
    }
    // Don't end the pool here if it's shared; comment out if needed
    // await pool.end();
    console.log("Database connection released.");
  }
}

// Run the function
createSuperAdmin();
