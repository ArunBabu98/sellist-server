// Node.js 20.6+ has native .env support via --env-file flag
// No dotenv needed!
// Development: node --env-file=.env --watch server.js
// Production: Environment variables from system

const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),
  apiKey: process.env.API_KEY,

  // Security
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  // eBay Configuration
  ebay: {
    appId: process.env.EBAY_APP_ID,
    certId: process.env.EBAY_CERT_ID,
    redirectUri: process.env.EBAY_REDIRECT_URI,
    useSandbox: process.env.EBAY_USE_SANDBOX === "true",
    fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID || "",
    paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID || "",
    returnPolicyId: process.env.EBAY_RETURN_POLICY_ID || "",
  },

  // AI Configuration
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL || "gpt-4",
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
    console.error("\n❌ CONFIGURATION ERROR ❌\n");
    console.error(
      `Missing required environment variables: ${missing.join(", ")}\n`
    );
    console.error("Please check your .env file contains:");
    missing.forEach((key) => {
      console.error(`  ${key}=your_value_here`);
    });
    console.error("\n💡 Development: npm run dev (uses --env-file=.env)");
    console.error(
      "💡 Production: Set environment variables in your deployment platform\n"
    );
    process.exit(1);
  }

  // Log successful configuration (only in development)
  if (config.isDevelopment) {
    console.log("\n✅ Configuration loaded successfully");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   Port: ${config.port}`);
    console.log(
      `   eBay Mode: ${config.ebay.useSandbox ? "🧪 Sandbox" : "🚀 Production"}`
    );
    console.log(`   API Key: ${config.apiKey ? "✓ Set" : "✗ Missing"}`);
    console.log(`   eBay App ID: ${config.ebay.appId?.substring(0, 20)}...`);
    console.log(`   Redirect URI: ${config.ebay.redirectUri}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }
};

// Validate on module load
validateConfig();

module.exports = config;
