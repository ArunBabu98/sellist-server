const axios = require("axios");
const EBAY_CONFIG = require("../../../config/ebay.config");
const authService = require("./auth.service");
const logger = require("../../../config/logger.config");

class TaxonomyService {
  /**
   * Suggest a VALID LEAF category for listing
   */
  async suggestCategory(title) {
    const appToken = await authService.getApplicationToken();

    const res = await axios.get(
      `${EBAY_CONFIG.baseUrl}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions`,
      {
        params: { q: title },
        headers: { Authorization: `Bearer ${appToken}` },
      }
    );

    const suggestions = res.data.categorySuggestions || [];

    if (!suggestions.length) {
      logger.warn("No category suggestions, using safe fallback");
      return {
        categoryId: "220", // Toys & Hobbies (leaf-safe)
        categoryName: "Toys & Hobbies",
      };
    }

    const parent = suggestions[0].category;

    const leafCategoryId = await this.resolveLeafCategory(parent.categoryId);

    return {
      categoryId: leafCategoryId,
      categoryName: parent.categoryName,
      parentCategoryId: parent.categoryId,
    };
  }

  /**
   * Resolve a category to its FIRST LEAF node
   * (Required for Inventory Offer creation)
   */
  async resolveLeafCategory(categoryId) {
    const appToken = await authService.getApplicationToken();

    const res = await axios.get(
      `${EBAY_CONFIG.baseUrl}/commerce/taxonomy/v1/category_tree/0/get_category_subtree`,
      {
        params: { category_id: categoryId },
        headers: {
          Authorization: `Bearer ${appToken}`,
        },
      }
    );

    // eBay response is NOT consistent
    const root =
      res.data.rootCategoryNode || res.data.categorySubtreeNode || null;

    // ✅ If no subtree returned → category IS A LEAF
    if (!root) {
      logger.info("Category is already a leaf", { categoryId });
      return categoryId;
    }

    const findLeaf = (node) => {
      if (
        !node.childCategoryTreeNodes ||
        node.childCategoryTreeNodes.length === 0
      ) {
        return node.category.categoryId;
      }

      // deterministic walk (first child)
      return findLeaf(node.childCategoryTreeNodes[0]);
    };

    const leafId = findLeaf(root);

    if (!leafId || !/^\d+$/.test(leafId)) {
      throw new Error(`Failed to resolve leaf category from ${categoryId}`);
    }

    return leafId;
  }

  /**
   * Get required item specifics for a category
   */
  async getCategoryAspects(categoryId) {
    const appToken = await authService.getApplicationToken();

    const res = await axios.get(
      `${EBAY_CONFIG.baseUrl}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category`,
      {
        params: { category_id: categoryId },
        headers: {
          Authorization: `Bearer ${appToken}`,
        },
      }
    );

    return res.data;
  }
}

module.exports = new TaxonomyService();
