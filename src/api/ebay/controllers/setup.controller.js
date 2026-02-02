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
    logger.info("SetupController: Opt-in request received");

    try {
      await setupService.optInPolicies(req.accessToken);
      return successResponse(res, null, "Opt-in successful");
    } catch (error) {
      if (error.response?.status === 409) {
        logger.info("SetupController: Already opted-in");
        return successResponse(res, null, "Already opted in");
      }

      logger.error("SetupController: Opt-in failed", {
        status: error.response?.status,
        data: error.response?.data,
      });

      return errorResponse(
        res,
        "Failed to opt-in",
        error.response?.status || 500,
        error.response?.data
      );
    }
  }

  async createLocation(req, res) {
    logger.info("SetupController: Create location request");

    try {
      await setupService.createLocation(req.accessToken);
      return successResponse(
        res,
        { locationKey: "default_location" },
        "Location created"
      );
    } catch (error) {
      if (error.response?.status === 409) {
        logger.info("SetupController: Location already exists");
        return successResponse(
          res,
          { locationKey: "default_location" },
          "Location already exists"
        );
      }

      logger.error("SetupController: Create location failed", {
        status: error.response?.status,
        data: error.response?.data,
      });

      return errorResponse(
        res,
        "Failed to create location",
        error.response?.status || 500,
        error.response?.data
      );
    }
  }

  async getPolicies(req, res) {
    logger.debug("SetupController: Get policies");

    try {
      const policies = await setupService.getPolicies(req.accessToken);
      return successResponse(res, policies);
    } catch (error) {
      logger.error("SetupController: Get policies failed", {
        status: error.response?.status,
        data: error.response?.data,
      });

      return errorResponse(
        res,
        "Failed to fetch policies",
        error.response?.status || 500,
        error.response?.data
      );
    }
  }

  async getLocations(req, res) {
    logger.debug("SetupController: Get locations");

    try {
      const locations = await setupService.getLocations(req.accessToken);
      return successResponse(res, locations);
    } catch (error) {
      logger.error("SetupController: Get locations failed", {
        status: error.response?.status,
        data: error.response?.data,
      });

      return errorResponse(
        res,
        "Failed to fetch locations",
        error.response?.status || 500,
        error.response?.data
      );
    }
  }
}

module.exports = new SetupController();
