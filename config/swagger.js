// config/swagger.js
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
require("dotenv").config();

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "RPM Dasgboard APIs (Dev Environment)",
      version: "1.0.0",
      description: "API documentation for developers",
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT}/api`, // Update if your base URL is different
      },
    ],
  },
  apis: ["./routes/*.js"], // path to your route files
};

const swaggerSpec = swaggerJsdoc(options);

function swaggerDocs(app) {
  if (process.env.NODE_ENV === "development") {
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    console.log(
      `✅ Swagger docs available at http://localhost:${process.env.PORT}/api-docs`
    );
  }
}

module.exports = swaggerDocs;
