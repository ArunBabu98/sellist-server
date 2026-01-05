const axios = require("axios");
const EBAY_CONFIG = require("../../../config/ebay.config");

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
  /**
   * ENTRY POINT
   * Ensures seller is opted-in and has at least 1 policy of each type.
   */
  async ensureDefaultPolicies(accessToken) {
    // 1️⃣ Opt-in (idempotent)
    try {
      await this.optInPolicies(accessToken);
    } catch (e) {
      if (e.response?.status !== 409) throw e;
    }

    // 2️⃣ Allow eBay internal propagation (CRITICAL)
    await new Promise((r) => setTimeout(r, 1500));

    // 3️⃣ Fetch existing policies (retry-safe)
    const policies = await retry(() => this.getPolicies(accessToken));

    const errors = [];

    // 4️⃣ Fulfillment
    if (!policies.fulfillmentPolicies.length) {
      try {
        await retry(() => this.createDefaultFulfillmentPolicy(accessToken));
      } catch (e) {
        errors.push(this._normalizeError("FULFILLMENT", e));
      }
    }

    // 5️⃣ Payment
    if (!policies.paymentPolicies.length) {
      try {
        await retry(() => this.createDefaultPaymentPolicy(accessToken));
      } catch (e) {
        errors.push(this._normalizeError("PAYMENT", e));
      }
    }

    // 6️⃣ Returns
    if (!policies.returnPolicies.length) {
      try {
        await retry(() => this.createDefaultReturnPolicy(accessToken));
      } catch (e) {
        errors.push(this._normalizeError("RETURN", e));
      }
    }

    // 7️⃣ Final verification
    const finalPolicies = await retry(() => this.getPolicies(accessToken));

    if (
      !finalPolicies.fulfillmentPolicies.length ||
      !finalPolicies.paymentPolicies.length ||
      !finalPolicies.returnPolicies.length
    ) {
      const err = new Error(
        "Seller account not ready for automatic policy setup"
      );
      err.details = errors;
      err.retryable = true;
      throw err;
    }

    return finalPolicies;
  }

  // ────────────────────────────────────────────────
  // EBAY API CALLS
  // ────────────────────────────────────────────────

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

  async getPolicies(accessToken) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const marketplaceId = "EBAY_US";

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

  // ────────────────────────────────────────────────
  // DEFAULT POLICY CREATORS (VALIDATED)
  // ────────────────────────────────────────────────

  async createDefaultFulfillmentPolicy(accessToken) {
    return axios.post(
      `${EBAY_CONFIG.baseUrl}/sell/account/v1/fulfillment_policy`,
      {
        name: "Sellist Default Shipping",
        marketplaceId: "EBAY_US",

        handlingTime: { unit: "DAY", value: 1 },

        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "CALCULATED",

            shipToLocations: {
              regionIncluded: [
                { regionName: "United States", regionType: "COUNTRY" },
              ],
            },
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  }

  async createDefaultPaymentPolicy(accessToken) {
    return axios.post(
      `${EBAY_CONFIG.baseUrl}/sell/account/v1/payment_policy`,
      {
        name: "Sellist Default Payment",
        marketplaceId: "EBAY_US",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  }

  async createDefaultReturnPolicy(accessToken) {
    return axios.post(
      `${EBAY_CONFIG.baseUrl}/sell/account/v1/return_policy`,
      {
        name: "Sellist 30 Day Returns",
        marketplaceId: "EBAY_US",
        returnsAccepted: true,
        returnPeriod: { unit: "DAY", value: 30 },
        returnShippingCostPayer: "BUYER",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  }

  // ────────────────────────────────────────────────
  // UTIL
  // ────────────────────────────────────────────────

  _normalizeError(policy, e) {
    return {
      policy,
      status: e.response?.status,
      errorId: e.response?.data?.errors?.[0]?.errorId,
      message: e.response?.data?.errors?.[0]?.message,
      raw: e.response?.data || e.message,
    };
  }
}

module.exports = new SetupService();
