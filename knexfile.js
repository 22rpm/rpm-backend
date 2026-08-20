// knexfile.js
require("dotenv").config();
module.exports = {
  development: {
    client: "mysql2",
    connection: {
      host: "localhost",
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    },
    migrations: {
      directory: "./config/migrations",
    },
  },

  production: {
    client: "mysql2",
    connection: {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    },
    migrations: {
      directory: "./config/migrations",
    },
  },

  // Replay verification: points at a THROWAWAY schema (rpm_db_reconcile) that
  // you create empty, migrate from scratch, and drop. Run it before any real
  // migration to prove the full migration set builds cleanly start-to-finish
  // (this is what caught the MRN migration having never actually executed).
  //   node -e '...' to CREATE DATABASE rpm_db_reconcile
  //   npx knex migrate:latest --env scratch
  //   ...diff its schema against the real DB, then DROP DATABASE.
  // Database is a LITERAL on purpose: neither .env nor the development block can
  // redirect it at your real data.
  scratch: {
    client: "mysql2",
    connection: {
      host: "127.0.0.1",
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: "rpm_db_reconcile",
    },
    migrations: { directory: "./config/migrations" },
  },
};
