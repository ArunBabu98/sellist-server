const path = require("path");
// Node.js 20.6+ has native .env support via --env-file flag
// No dotenv needed!
// Development: node --env-file=.env server.js
// Production: Environment variables from system

const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),
  logLevel: process.env.LOG_LEVEL || "info",

  // Security
  apiKey: process.env.API_KEY,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || [],

  // eBay
  ebay: {
    appId: process.env.EBAY_APP_ID,
    certId: process.env.EBAY_CERT_ID,
    redirectUri: process.env.EBAY_REDIRECT_URI,
    useSandbox: process.env.USE_SANDBOX === "true",
    fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID,
    paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID,
    returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
  },

  // Helpers
  get isProduction() {
    return this.nodeEnv === "production";
  },
  get isDevelopment() {
    return this.nodeEnv === "development";
  },
};

// Validate required environment variables
const validateConfig = () => {
  const required = [
    { key: "API_KEY", value: config.apiKey },
    { key: "EBAY_APP_ID", value: config.ebay.appId },
    { key: "EBAY_CERT_ID", value: config.ebay.certId },
    { key: "EBAY_REDIRECT_URI", value: config.ebay.redirectUri },
  ];

  const missing = required.filter((r) => !r.value).map((r) => r.key);

  if (missing.length > 0) {
    console.error(
      `❌ Missing required environment variables: ${missing.join(", ")}`
    );
    console.error(`💡 For development: node --env-file=.env server.js`);
    console.error(
      `💡 For production: Set environment variables in deployment platform`
    );
    process.exit(1);
  }
};

// Validate on module load
validateConfig();

module.exports = config;
