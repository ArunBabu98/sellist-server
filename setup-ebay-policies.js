require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// eBay Configuration
const EBAY_CONFIG = {
  useSandbox: process.env.USE_SANDBOX === "true",

  get accountApiUrl() {
    return this.useSandbox
      ? "https://api.sandbox.ebay.com/sell/account/v1"
      : "https://api.ebay.com/sell/account/v1";
  },
};

// Get user access token from command line
function getUserAccessToken() {
  const token = process.argv[2];

  if (!token) {
    console.error("\n❌ Error: No access token provided");
    console.log("\nUsage:");
    console.log("  node setup-ebay-policies.js YOUR_ACCESS_TOKEN\n");
    console.log("To get your access token:");
    console.log("  1. Run your Flutter app");
    console.log("  2. Go to Settings → Setup Business Policies");
    console.log("  3. Copy the token or full command\n");
    process.exit(1);
  }

  return token;
}

// Create Payment Policy
async function createPaymentPolicy(accessToken) {
  try {
    const payload = {
      name: "Immediate Payment Required",
      description: "Payment required immediately upon purchase",
      marketplaceId: "EBAY_US",
      immediatePay: true,
      categoryTypes: [
        {
          name: "ALL_EXCLUDING_MOTORS_VEHICLES",
          default: true,
        },
      ],
    };

    console.log("📝 Creating payment policy...");
    const response = await axios.post(
      `${EBAY_CONFIG.accountApiUrl}/payment_policy`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      }
    );

    const policyId = response.data.paymentPolicyId;
    console.log(`✅ Payment policy created: ${policyId}`);
    return policyId;
  } catch (error) {
    console.error("❌ Failed to create payment policy:");
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    throw error;
  }
}

// Create Return Policy
async function createReturnPolicy(accessToken) {
  try {
    const payload = {
      name: "30 Day Returns Accepted",
      description: "30 day return policy, buyer pays return shipping",
      marketplaceId: "EBAY_US",
      returnsAccepted: true,
      returnPeriod: {
        value: 30,
        unit: "DAY",
      },
      returnShippingCostPayer: "BUYER",
      categoryTypes: [
        {
          name: "ALL_EXCLUDING_MOTORS_VEHICLES",
          default: true,
        },
      ],
    };

    console.log("📝 Creating return policy...");
    const response = await axios.post(
      `${EBAY_CONFIG.accountApiUrl}/return_policy`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      }
    );

    const policyId = response.data.returnPolicyId;
    console.log(`✅ Return policy created: ${policyId}`);
    return policyId;
  } catch (error) {
    console.error("❌ Failed to create return policy:");
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    throw error;
  }
}

// Create Fulfillment Policy
async function createFulfillmentPolicy(accessToken) {
  try {
    const payload = {
      name: "Free Standard Shipping",
      description: "Free shipping via USPS Priority Mail",
      marketplaceId: "EBAY_US",
      categoryTypes: [
        {
          name: "ALL_EXCLUDING_MOTORS_VEHICLES",
          default: true,
        },
      ],
      handlingTime: {
        value: 1,
        unit: "DAY",
      },
      shippingOptions: [
        {
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [
            {
              shippingCarrierCode: "USPS",
              shippingServiceCode: "USPSPriority",
              shippingCost: {
                value: "0.00",
                currency: "USD",
              },
              freeShipping: true,
              shipToLocations: {
                regionIncluded: [
                  {
                    regionName: "US",
                    regionType: "COUNTRY",
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    console.log("📝 Creating fulfillment policy...");
    const response = await axios.post(
      `${EBAY_CONFIG.accountApiUrl}/fulfillment_policy`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      }
    );

    const policyId = response.data.fulfillmentPolicyId;
    console.log(`✅ Fulfillment policy created: ${policyId}`);
    return policyId;
  } catch (error) {
    console.error("❌ Failed to create fulfillment policy:");
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    throw error;
  }
}

// Update .env file with policy IDs
function updateEnvFile(paymentPolicyId, returnPolicyId, fulfillmentPolicyId) {
  try {
    const envPath = path.join(__dirname, ".env");
    let envContent = "";

    // Read existing .env file if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf8");
    }

    // Update or add policy IDs
    const policies = {
      EBAY_PAYMENT_POLICY_ID: paymentPolicyId,
      EBAY_RETURN_POLICY_ID: returnPolicyId,
      EBAY_FULFILLMENT_POLICY_ID: fulfillmentPolicyId,
    };

    Object.entries(policies).forEach(([key, value]) => {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(envContent)) {
        // Update existing
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        // Add new line if content doesn't end with newline
        if (envContent && !envContent.endsWith("\n")) {
          envContent += "\n";
        }
        envContent += `${key}=${value}\n`;
      }
    });

    fs.writeFileSync(envPath, envContent);
    console.log("\n✅ .env file updated successfully!");
    return true;
  } catch (error) {
    console.error("\n❌ Failed to update .env file:", error.message);
    console.log("\n📋 Please manually add these to your .env file:");
    console.log(`EBAY_PAYMENT_POLICY_ID=${paymentPolicyId}`);
    console.log(`EBAY_RETURN_POLICY_ID=${returnPolicyId}`);
    console.log(`EBAY_FULFILLMENT_POLICY_ID=${fulfillmentPolicyId}`);
    return false;
  }
}

// Main execution
async function main() {
  console.log("\n🚀 eBay Business Policies Setup");
  console.log("═══════════════════════════════════════");
  console.log(
    `📦 Environment: ${EBAY_CONFIG.useSandbox ? "Sandbox ✓" : "Production"}`
  );
  console.log("═══════════════════════════════════════\n");

  try {
    // Get user access token
    const accessToken = getUserAccessToken();
    console.log("✅ Access token received\n");

    // Create all three policies
    const paymentPolicyId = await createPaymentPolicy(accessToken);
    console.log("");

    const returnPolicyId = await createReturnPolicy(accessToken);
    console.log("");

    const fulfillmentPolicyId = await createFulfillmentPolicy(accessToken);

    // Update .env file
    const updated = updateEnvFile(
      paymentPolicyId,
      returnPolicyId,
      fulfillmentPolicyId
    );

    // Display summary
    console.log("\n═══════════════════════════════════════");
    console.log("📋 Policy IDs Created:");
    console.log("═══════════════════════════════════════");
    console.log(`Payment:     ${paymentPolicyId}`);
    console.log(`Return:      ${returnPolicyId}`);
    console.log(`Fulfillment: ${fulfillmentPolicyId}`);
    console.log("═══════════════════════════════════════");

    if (updated) {
      console.log("\n⚠️  NEXT STEPS:");
      console.log("   1. Restart your Node.js server");
      console.log("   2. You can now publish listings to eBay!");
      console.log(
        "   3. (Optional) Remove /api/ebay/get-token endpoint from server.js\n"
      );
    }

    console.log("✅ Setup complete!\n");
  } catch (error) {
    console.error("\n❌ Setup failed:", error.message);
    console.error("\nCommon issues:");
    console.error("  • Token expired - Get a fresh token from the app");
    console.error("  • Not authenticated - Connect to eBay in the app first");
    console.error(
      "  • Wrong environment - Check USE_SANDBOX setting in .env\n"
    );
    process.exit(1);
  }
}

main();
