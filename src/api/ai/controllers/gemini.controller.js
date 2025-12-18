const geminiService = require("../services/gemini.service");
const {
  successResponse,
  errorResponse,
} = require("../../../utils/apiResponse");
const logger = require("../../../config/logger.config");

class GeminiController {
  async analyzeImage(req, res) {
    try {
      const { imageBase64, mimeType } = req.body;

      if (!imageBase64) {
        return errorResponse(res, "imageBase64 is required", 400);
      }

      logger.info("AI analyzeImage called");

      const listingPayload = await geminiService.analyzeSingleImageFromBase64(
        imageBase64,
        mimeType || "image/jpeg"
      );

      return successResponse(res, listingPayload, "Analysis successful");
    } catch (err) {
      logger.error("AI analyzeImage failed", {
        error: err.message,
        stack: err.stack,
      });
      return errorResponse(res, "AI image analysis failed", 500, err.message);
    }
  }

  async analyzeImages(req, res) {
    try {
      const { images } = req.body;
      // images: [{ imageBase64: string, mimeType?: string }, ...]

      if (!Array.isArray(images) || images.length === 0) {
        return errorResponse(res, "images array is required", 400);
      }

      logger.info("AI analyzeImages called", { count: images.length });

      const normalized = images.map((img) => ({
        base64: img.imageBase64,
        mimeType: img.mimeType || "image/jpeg",
      }));

      const listingPayload =
        await geminiService.analyzeMultipleImagesFromBase64(normalized);

      return successResponse(
        res,
        listingPayload,
        "Multi-image analysis successful"
      );
    } catch (err) {
      logger.error("AI analyzeImages failed", {
        error: err.message,
        stack: err.stack,
      });
      return errorResponse(
        res,
        "AI multi-image analysis failed",
        500,
        err.message
      );
    }
  }
}

module.exports = new GeminiController();
