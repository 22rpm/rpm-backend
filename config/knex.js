// config/knex.js
const knex = require("knex");
const knexConfig = require("../knexfile");

const environment = process.env.NODE_ENV || "development";
const knexDb = knex(knexConfig[environment]);

module.exports = knexDb;
