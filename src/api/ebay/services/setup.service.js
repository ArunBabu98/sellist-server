const axios = require("axios");
const EBAY_CONFIG = require("../../../config/ebay.config");
const logger = require("../../../config/logger.config");

/**
 * Simple retry helper for transient eBay failures (503 / LSAS warmup)
 */
async function retry(fn, { retries = 5, baseDelay = 800, factor = 2 } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (e) {
      const status = e.response?.status;

      // Retry ONLY transient eBay failures
      if (attempt >= retries || ![503, 504].includes(status)) {
        throw e;
      }

      const delay = baseDelay * Math.pow(factor, attempt);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

class SetupService {
  async optInPolicies(accessToken) {
    logger.info("eBay Setup: Opt-in to Business Policies started");

    try {
      await axios.post(
        `${EBAY_CONFIG.baseUrl}/sell/account/v1/program/opt_in`,
        { programType: "SELLING_POLICY_MANAGEMENT" },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      logger.info("eBay Setup: Opt-in successful");
    } catch (error) {
      logger.warn("eBay Setup: Opt-in failed", {
        status: error.response?.status,
        data: error.response?.data,
      });
      throw error;
    }
  }

  async createLocation(accessToken) {
    logger.info("eBay Setup: Creating inventory location");

    const locationPayload = {
      location: {
        address: {
          addressLine1: "123 Main Street",
          city: "San Jose",
          stateOrProvince: "CA",
          postalCode: "95125",
          country: "US",
        },
      },
      locationInstructions: "Items ship from here",
      name: "Primary Location",
      merchantLocationStatus: "ENABLED",
      locationTypes: ["WAREHOUSE"],
    };

    try {
      await axios.post(
        `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/location/default_location`,
        locationPayload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      logger.info("eBay Setup: Inventory location created");
    } catch (error) {
      logger.warn("eBay Setup: Create location failed", {
        status: error.response?.status,
        data: error.response?.data,
      });
      throw error;
    }
  }

  async getPolicies(accessToken) {
    logger.debug("eBay Setup: Fetching seller policies");

    const headers = { Authorization: `Bearer ${accessToken}` };
    const marketplaceId = "EBAY_US";

    try {
      const [fulfillment, payment, returns] = await Promise.all([
        axios.get(`${EBAY_CONFIG.baseUrl}/sell/account/v1/fulfillment_policy`, {
          headers,
          params: { marketplace_id: marketplaceId },
        }),
        axios.get(`${EBAY_CONFIG.baseUrl}/sell/account/v1/payment_policy`, {
          headers,
          params: { marketplace_id: marketplaceId },
        }),
        axios.get(`${EBAY_CONFIG.baseUrl}/sell/account/v1/return_policy`, {
          headers,
          params: { marketplace_id: marketplaceId },
        }),
      ]);

      logger.info("eBay Setup: Policies fetched", {
        fulfillment: fulfillment.data.fulfillmentPolicies?.length || 0,
        payment: payment.data.paymentPolicies?.length || 0,
        returns: returns.data.returnPolicies?.length || 0,
      });

      return {
        fulfillmentPolicies: fulfillment.data.fulfillmentPolicies || [],
        paymentPolicies: payment.data.paymentPolicies || [],
        returnPolicies: returns.data.returnPolicies || [],
      };
    } catch (error) {
      logger.error("eBay Setup: Fetch policies failed", {
        status: error.response?.status,
        data: error.response?.data,
      });
      throw error;
    }
  }

  async getLocations(accessToken) {
    logger.debug("eBay Setup: Fetching inventory locations");

    try {
      const response = await axios.get(
        `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/location`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      logger.info("eBay Setup: Locations fetched", {
        count: response.data.locations?.length || 0,
      });

      return response.data.locations || [];
    } catch (error) {
      logger.error("eBay Setup: Fetch locations failed", {
        status: error.response?.status,
        data: error.response?.data,
      });
      throw error;
    }
  }
}

module.exports = new SetupService();
