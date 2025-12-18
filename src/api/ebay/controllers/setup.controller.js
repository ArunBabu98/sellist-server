const setupService = require("../services/setup.service");
const {
  successResponse,
  errorResponse,
} = require("../../../utils/apiResponse");
const logger = require("../../../config/logger.config");

class SetupController {
  async optInPolicies(req, res) {
    try {
      logger.info("Opting in to Business Policies");
      await setupService.optInPolicies(req.accessToken);
      logger.info("Successfully opted in to Business Policies");

      successResponse(
        res,
        null,
        "Successfully opted in to Business Policies Management"
      );
    } catch (error) {
      logger.error("Opt-in failed", { error: error.message });

      if (error.response?.status === 409) {
        return successResponse(
          res,
          null,
          "Already opted in to Business Policies"
        );
      }

      const status = error.response?.status || 500;
      errorResponse(res, "Failed to opt-in", status, error.response?.data);
    }
  }

  async createLocation(req, res) {
    try {
      logger.info("Creating inventory location");
      await setupService.createLocation(req.accessToken);
      logger.info("Location created successfully");

      successResponse(
        res,
        { locationKey: "default_location" },
        "Inventory location created successfully"
      );
    } catch (error) {
      logger.error("Location creation failed", { error: error.message });

      if (error.response?.status === 409) {
        return successResponse(
          res,
          { locationKey: "default_location" },
          "Location already exists"
        );
      }

      const status = error.response?.status || 500;
      errorResponse(
        res,
        "Failed to create location",
        status,
        error.response?.data
      );
    }
  }
}

module.exports = new SetupController();
