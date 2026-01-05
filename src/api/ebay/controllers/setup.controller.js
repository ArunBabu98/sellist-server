const setupService = require("../services/setup.service");
const {
  successResponse,
  errorResponse,
} = require("../../../utils/apiResponse");
const logger = require("../../../config/logger.config");

class SetupController {
  async ensurePolicies(req, res) {
    try {
      const policies = await setupService.ensureDefaultPolicies(
        req.accessToken
      );

      successResponse(res, policies, "Policies ensured successfully");
    } catch (error) {
      logger.error("Failed to ensure policies", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        details: error.details,
      });

      errorResponse(
        res,
        "Seller account not ready for business policies",
        error.response?.status || 409,
        error.details || error.response?.data || error.message
      );
    }
  }

  async optInPolicies(req, res) {
    try {
      await setupService.optInPolicies(req.accessToken);
      successResponse(
        res,
        null,
        "Successfully opted in to Business Policies Management"
      );
    } catch (error) {
      if (error.response?.status === 409) {
        return successResponse(
          res,
          null,
          "Already opted in to Business Policies"
        );
      }

      errorResponse(
        res,
        "Failed to opt-in",
        error.response?.status || 500,
        error.response?.data
      );
    }
  }

  async createLocation(req, res) {
    try {
      await setupService.createLocation(req.accessToken);
      successResponse(
        res,
        { locationKey: "default_location" },
        "Inventory location created successfully"
      );
    } catch (error) {
      if (error.response?.status === 409) {
        return successResponse(
          res,
          { locationKey: "default_location" },
          "Location already exists"
        );
      }

      errorResponse(
        res,
        "Failed to create location",
        error.response?.status || 500,
        error.response?.data
      );
    }
  }

  // ✅ NEW: Get policies
  async getPolicies(req, res) {
    try {
      const policies = await setupService.getPolicies(req.accessToken);

      successResponse(res, policies, "Policies retrieved successfully");
    } catch (error) {
      logger.error("Failed to fetch policies", {
        error: error.response?.data || error.message,
      });

      errorResponse(
        res,
        "Failed to fetch policies",
        error.response?.status || 500,
        error.response?.data
      );
    }
  }

  // ✅ NEW: Get locations
  async getLocations(req, res) {
    try {
      const locations = await setupService.getLocations(req.accessToken);

      successResponse(
        res,
        locations,
        "Inventory locations retrieved successfully"
      );
    } catch (error) {
      logger.error("Failed to fetch locations", {
        error: error.response?.data || error.message,
      });

      errorResponse(
        res,
        "Failed to fetch locations",
        error.response?.status || 500,
        error.response?.data
      );
    }
  }
}

module.exports = new SetupController();
