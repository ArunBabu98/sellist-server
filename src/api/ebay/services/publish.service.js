// services/ebay/publish.service.js
const axios = require("axios");
const EBAY_CONFIG = require("../../../config/ebay.config");
const logger = require("../../../config/logger.config");

class PublishService {
  async publishOffer(accessToken, offerId) {
    logger.info("PublishService.publishOffer:start", { offerId });

    const res = await axios.post(
      `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/offer/${offerId}/publish`,
      null,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    logger.info("PublishService.publishOffer:success", {
      offerId,
      status: res.status,
    });

    return res.data;
  }
}

module.exports = new PublishService();
