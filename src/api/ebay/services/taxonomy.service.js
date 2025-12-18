const axios = require("axios");
const EBAY_CONFIG = require("../../../config/ebay.config");
const authService = require("./auth.service");
const logger = require("../../../config/logger.config");

class TaxonomyService {
  async suggestCategory(title, itemSpecifics) {
    const appToken = await authService.getApplicationToken();

    const response = await axios.get(
      `${EBAY_CONFIG.baseUrl}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions`,
      {
        params: { q: title },
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const suggestions = response.data.categorySuggestions || [];

    if (suggestions.length > 0) {
      const topCategory = suggestions[0].category;
      logger.info("Category suggestion found", {
        categoryId: topCategory.categoryId,
        categoryName: topCategory.categoryName,
      });

      return {
        categoryId: topCategory.categoryId,
        categoryName: topCategory.categoryName,
        allSuggestions: suggestions.map((s) => ({
          id: s.category.categoryId,
          name: s.category.categoryName,
        })),
      };
    }

    logger.warn("No category suggestions found, using fallback");
    return {
      categoryId: "220",
      categoryName: "Toys & Hobbies",
      allSuggestions: [],
    };
  }

  async getCategoryAspects(categoryId) {
    const appToken = await authService.getApplicationToken();

    const response = await axios.get(
      `${EBAY_CONFIG.baseUrl}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category`,
      {
        params: { category_id: categoryId },
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  }
}

module.exports = new TaxonomyService();
