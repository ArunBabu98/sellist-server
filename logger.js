const winston = require("winston");
const config = require("./config");

// Custom format to redact sensitive data
const redactSensitiveData = winston.format((info) => {
  const sensitiveKeys = [
    "password",
    "token",
    "apiKey",
    "api_key",
    "secret",
    "authorization",
    "refresh_token",
    "access_token",
    "clientSecret",
    "cert_id",
    "credentials",
  ];

  const redact = (obj) => {
    if (typeof obj !== "object" || obj === null) return obj;

    for (const key in obj) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        obj[key] = "[REDACTED]";
      } else if (typeof obj[key] === "object") {
        redact(obj[key]);
      }
    }
    return obj;
  };

  return redact(info);
});

// Create logger with different transports based on environment
const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    redactSensitiveData(),
    winston.format.json()
  ),
  defaultMeta: {
    service: "ebay-integration-api",
    environment: config.nodeEnv,
  },
  transports: [
    // File transport for errors
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: "logs/exceptions.log" }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: "logs/rejections.log" }),
  ],
});

// Console transport for development
if (config.isDevelopment) {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr =
            Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : "";
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      ),
    })
  );
} else {
  // Production console logging (JSON for log aggregation services)
  logger.add(
    new winston.transports.Console({
      format: winston.format.json(),
    })
  );
}

module.exports = logger;
