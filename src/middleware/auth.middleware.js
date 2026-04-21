const jwt = require("jsonwebtoken");
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

const authenticate = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(res, "No access token provided", 401);
  }

  const token = authHeader.substring(7);

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.userId;
    next();
  } catch (err) {
    logger.warn("Invalid JWT attempt", { ip: req.ip, error: err.message });
    return errorResponse(res, "Token expired or invalid", 401);
  }
};

const extractEbayToken = (req, res, next) => {
  const ebayToken = req.headers["x-ebay-access-token"];
  if (!ebayToken) {
    return errorResponse(res, "No eBay access token provided", 401);
  }
  req.accessToken = ebayToken; // controllers already use req.accessToken
  next();
};

const verifyApiKeyAndUser = [verifyApiKey, authenticate];

module.exports = {
  verifyApiKey,
  verifyBearerToken,
  authenticate,
  extractEbayToken,
  verifyApiKeyAndUser,
};
