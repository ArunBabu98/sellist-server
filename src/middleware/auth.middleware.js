const logger = require("../config/logger.config");
const config = require("../config");
const { errorResponse } = require("../utils/apiResponse");

const verifyApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== config.apiKey) {
    logger.warn("Unauthorized API key attempt", { ip: req.ip });
    return errorResponse(res, "Unauthorized: Invalid API key", 401);
  }

  next();
};

const verifyBearerToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(res, "No access token provided", 401);
  }

  req.accessToken = authHeader.substring(7);
  next();
};

module.exports = {
  verifyApiKey,
  verifyBearerToken,
};
