const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const config = require("./config");
const routes = require("./routes");
const { loggingMiddleware } = require("./middleware/logging.middleware");
const {
  errorHandler,
  notFoundHandler,
} = require("./middleware/error.middleware");

const app = express();

// Security: Helmet sets various HTTP headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (config.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        if (config.isProduction) {
          callback(new Error("Not allowed by CORS"));
        } else {
          callback(null, true);
        }
      }
    },
    credentials: true,
  })
);

// Parse JSON bodies with increased limit for image uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Request logging middleware
app.use(loggingMiddleware);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
  });
});

// API routes
app.use("/api", routes);

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
