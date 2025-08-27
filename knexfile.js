// knexfile.js
require('dotenv').config();
module.exports = {
  development: {
    client: "mysql2",
    connection: {
      host: "localhost",
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: "rpm_db",
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
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    },
    migrations: {
      directory: "./config/migrations",
    },
  },
};
