const taxonomyService = require("../services/taxonomy.service");
const {
  successResponse,
  errorResponse,
} = require("../../../utils/apiResponse");
const logger = require("../../../config/logger.config");

class TaxonomyController {
  async suggestCategory(req, res) {
    try {
      const { title, itemSpecifics } = req.body;

      if (!title) {
        return errorResponse(res, "Title is required", 400);
      }

      logger.info("Getting category suggestions", { title });
      const suggestions = await taxonomyService.suggestCategory(
        title,
        itemSpecifics
      );
      successResponse(res, suggestions);
    } catch (error) {
      logger.error("Category suggestion failed", { error: error.message });

      const fallback = {
        categoryId: "220",
        categoryName: "Toys & Hobbies",
        allSuggestions: [],
        error: error.message,
      };

      successResponse(res, fallback);
    }
  }

  async getCategoryAspects(req, res) {
    try {
      const { categoryId } = req.params;

      logger.info("Getting category aspects", { categoryId });
      const aspects = await taxonomyService.getCategoryAspects(categoryId);
      logger.info("Category aspects retrieved", {
        categoryId,
        aspectCount: aspects.aspects?.length || 0,
      });

      successResponse(res, aspects);
    } catch (error) {
      logger.error("Category aspects retrieval failed", {
        error: error.message,
      });
      errorResponse(
        res,
        "Failed to get category aspects",
        500,
        error.response?.data
      );
    }
  }
}

module.exports = new TaxonomyController();
