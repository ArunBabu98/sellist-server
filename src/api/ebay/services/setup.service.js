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
}

module.exports = new SetupService();
