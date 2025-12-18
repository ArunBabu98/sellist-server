const logger = require("../config/logger.config");

const loggingMiddleware = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    logger.http({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: Date.now() - start,
      ip: req.ip,
    });
  });

  next();
};

module.exports = { loggingMiddleware };
