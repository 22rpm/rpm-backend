// migration-runner.js
require("dotenv").config();
const { Sequelize } = require("sequelize");
const { Umzug, SequelizeStorage } = require("umzug");

// 1. Create sequelize instance
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: "mysql",
  }
);

// 2. Configure Umzug (migration tool)
const umzug = new Umzug({
  migrations: {
    glob: "migrations/*.js",
    resolve: ({ name, path, context }) => {
      const migration = require(path);
      return {
        name,
        up: async () => migration.up(context, Sequelize),
        down: async () => migration.down(context, Sequelize),
      };
    },
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});

// 3. Run migrations
const runMigrations = async () => {
  try {
    await sequelize.authenticate();
    await umzug.up();
    console.log("Migrations executed successfully");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await sequelize.close();
  }
};

runMigrations();
