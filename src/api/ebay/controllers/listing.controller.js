const listingService = require("../services/listing.service");
const {
  successResponse,
  errorResponse,
} = require("../../../utils/apiResponse");
const logger = require("../../../config/logger.config");
const publishService = require("../services/publish.service");
const { deductSafe } = require("../../../utils/deductSafe");

class ListingController {
  async publishListing(req, res) {
    try {
      const listingData = req.body;
      const accessToken = req.accessToken;

      logger.info("Publishing listing", {
        sku: listingData.sku,
        title: listingData.title,
        price: listingData.price,
        categoryId: listingData.categoryId,
      });

      const result = await listingService.publishListing(
        accessToken,
        listingData,
      );

      logger.info("Listing published successfully", {
        listingId: result.listingId,
        sku: result.sku,
      });

      await deductSafe(req);

      successResponse(res, result, "Listing published successfully");
    } catch (error) {
      logger.error("Publish listing failed", {
        error: error.message,
        status: error.response?.status,
      });

      const status = error.response?.status || 500;
      const errorData = error.response?.data;

      let message = "Failed to publish listing";
      if (errorData?.errors && errorData.errors.length > 0) {
        message = errorData.errors.map((e) => e.message).join("; ");
      }

      errorResponse(res, message, status, errorData?.errors);
    }
  }
  async publishDraftOffer(req, res) {
    try {
      const { offerId, includeSubtitle = true } = req.body;
      const accessToken = req.accessToken;

      if (!offerId) {
        return errorResponse(res, "offerId is required", 400);
      }

      logger.info("Publishing existing draft offer", {
        offerId,
        includeSubtitle,
      });

      await publishService.publishOffer(accessToken, offerId);

      logger.info("Draft offer published", { offerId });
      await deductSafe(req);

      successResponse(res, { offerId }, "Offer published successfully");
    } catch (error) {
      logger.error("Publish draft offer failed", {
        error: error.message,
        status: error.response?.status,
      });

      const status = error.response?.status || 500;
      const errorData = error.response?.data;

      let message = "Failed to publish offer";
      if (errorData?.errors?.length) {
        message = errorData.errors.map((e) => e.message).join("; ");
      }

      errorResponse(res, message, status, errorData?.errors);
    }
  }
}

module.exports = new ListingController();
