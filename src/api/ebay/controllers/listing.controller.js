const listingService = require("../services/listing.service");
const {
  successResponse,
  errorResponse,
} = require("../../../utils/apiResponse");
const logger = require("../../../config/logger.config");

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
        listingData
      );

      logger.info("Listing published successfully", {
        listingId: result.listingId,
        sku: result.sku,
      });

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
}

module.exports = new ListingController();
