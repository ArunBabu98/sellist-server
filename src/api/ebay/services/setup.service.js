const axios = require("axios");
const EBAY_CONFIG = require("../../../config/ebay.config");

class SetupService {
  async optInPolicies(accessToken) {
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
  }

  async createLocation(accessToken) {
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
  }
  async getPolicies(accessToken) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const marketplaceId = "EBAY_US"; // 🔑 REQUIRED

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

    return {
      fulfillmentPolicies: fulfillment.data.fulfillmentPolicies || [],
      paymentPolicies: payment.data.paymentPolicies || [],
      returnPolicies: returns.data.returnPolicies || [],
    };
  }

  // ✅ NEW: Get inventory locations
  async getLocations(accessToken) {
    const response = await axios.get(
      `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/location`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return response.data.locations || [];
  }
}

module.exports = new SetupService();
