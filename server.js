const app = require("./src/app");
const config = require("./src/config");
const logger = require("./src/config/logger.config");
const { getLocalIP } = require("./src/utils/helpers");

// Graceful shutdown handler
function gracefulShutdown(signal, server) {
  logger.info(`${signal} received, starting graceful shutdown`);

  if (server) {
    server.close((err) => {
      if (err) {
        logger.error("Error during server shutdown", { error: err.message });
        process.exit(1);
      }

      logger.info("HTTP server closed");
      logger.info("Graceful shutdown complete");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 30000);
  } else {
    process.exit(0);
  }
}

// Start server
const server = app.listen(config.port, "0.0.0.0", () => {
  const localIP = getLocalIP();
  logger.info("Server started", {
    port: config.port,
    environment: config.nodeEnv,
    localUrl: `http://localhost:${config.port}`,
    networkUrl: `http://${localIP}:${config.port}`,
  });
});

// Process event handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server));
process.on("SIGINT", () => gracefulShutdown("SIGINT", server));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection", {
    reason: reason?.message || reason,
    stack: reason?.stack,
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", {
    error: error.message,
    stack: error.stack,
  });
  gracefulShutdown("UNCAUGHT_EXCEPTION", server);
});

module.exports = server;
