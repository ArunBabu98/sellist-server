const mediaService = require("../services/media.service");
const {
  successResponse,
  errorResponse,
} = require("../../../utils/apiResponse");
const logger = require("../../../config/logger.config");

class MediaController {
  async uploadImage(req, res) {
    try {
      const { imageData, filename } = req.body;

      if (!imageData) {
        return errorResponse(res, "Image data is required", 400);
      }

      logger.info("Uploading image", { filename });

      const imageBuffer = Buffer.from(imageData, "base64");
      const fileSizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(2);

      logger.debug("Image size", { sizeMB: fileSizeMB });

      if (imageBuffer.length > 12 * 1024 * 1024) {
        return errorResponse(
          res,
          `Image too large: ${fileSizeMB} MB. Maximum is 12 MB`,
          400
        );
      }

      const result = await mediaService.uploadImage(
        req.accessToken,
        imageBuffer,
        filename
      );

      logger.info("Image uploaded successfully", { imageUrl: result.imageUrl });

      successResponse(res, result, "Image uploaded successfully", 201);
    } catch (error) {
      logger.error("Image upload failed", {
        error: error.message,
        status: error.response?.status,
      });

      const status = error.response?.status || 500;
      const errorData = error.response?.data;

      let errorMessage = "Failed to upload image";
      if (errorData?.errors && errorData.errors.length > 0) {
        errorMessage =
          errorData.errors[0].longMessage || errorData.errors[0].message;
      }

      errorResponse(res, errorMessage, status, errorData);
    }
  }
}

module.exports = new MediaController();
