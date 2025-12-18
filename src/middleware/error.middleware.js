const logger = require("../config/logger.config");
const config = require("../config");
const { errorResponse } = require("../utils/apiResponse");

const errorHandler = (err, req, res, next) => {
  logger.error("Unhandled error", {
    error: err.message,
    stack: config.isDevelopment ? err.stack : undefined,
    url: req.url,
    method: req.method,
  });

  const message = config.isProduction ? "Internal server error" : err.message;
  errorResponse(res, message, 500);
};

const notFoundHandler = (req, res) => {
  logger.warn("Route not found", { url: req.url, method: req.method });
  errorResponse(res, "Not found", 404);
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
