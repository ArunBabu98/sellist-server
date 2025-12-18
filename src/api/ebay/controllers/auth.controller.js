const authService = require("../services/auth.service");
const {
  successResponse,
  errorResponse,
} = require("../../../utils/apiResponse");
const logger = require("../../../config/logger.config");

class AuthController {
  async generateAuthUrl(req, res) {
    try {
      const result = authService.generateAuthUrl();
      logger.info("Auth URL requested", { state: result.state });
      successResponse(res, result);
    } catch (error) {
      logger.error("Auth URL generation failed", { error: error.message });
      errorResponse(res, error.message, 500);
    }
  }

  async exchangeToken(req, res) {
    try {
      const { code, state } = req.body;

      if (!code || !state) {
        return errorResponse(res, "Code and state are required", 400);
      }

      logger.info("Exchanging authorization code", { state });
      const tokens = await authService.exchangeToken(code);
      logger.info("Token exchange successful");
      successResponse(res, tokens);
    } catch (error) {
      logger.error("Token exchange failed", {
        error: error.message,
        status: error.response?.status,
      });

      const status = error.response?.status || 500;
      const message =
        error.response?.data?.error_description ||
        "Failed to exchange authorization code";

      errorResponse(res, message, status);
    }
  }

  async refreshToken(req, res) {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return errorResponse(res, "Refresh token is required", 400);
      }

      logger.info("Refreshing access token");
      const tokens = await authService.refreshToken(refresh_token);
      logger.info("Token refresh successful");
      successResponse(res, tokens);
    } catch (error) {
      logger.error("Token refresh failed", {
        error: error.message,
        status: error.response?.status,
      });

      const status = error.response?.status || 500;
      const message =
        error.response?.data?.error_description || "Failed to refresh token";

      errorResponse(res, message, status);
    }
  }

  async getUserProfile(req, res) {
    try {
      const profile = await authService.getUserProfile(req.accessToken);
      logger.info("User profile retrieved successfully");
      successResponse(res, profile);
    } catch (error) {
      logger.error("User profile retrieval failed", {
        error: error.message,
        status: error.response?.status,
      });

      const status = error.response?.status || 500;
      const message =
        error.response?.data?.errors?.[0]?.message ||
        "Failed to fetch user profile";

      errorResponse(res, message, status);
    }
  }

  async getToken(req, res) {
    successResponse(res, { token: req.accessToken });
  }
}

module.exports = new AuthController();
