// // config/knex.js
// const knex = require("knex");
// const knexConfig = require("../knexfile");

// const environment = process.env.NODE_ENV || "development";
// const knexDb = knex(knexConfig[environment]);

// module.exports = knexDb;

// config/knex.js
const knex = require("knex");

const knexDb = knex({
  client: "mysql2",
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  },
  pool: { min: 0, max: 10 },
});

module.exports = knexDb;
