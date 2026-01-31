const axios = require("axios");
const EBAY_CONFIG = require("../../../config/ebay.config");
const authService = require("./auth.service");
const logger = require("../../../config/logger.config");

class TaxonomyService {
  /**
   * Official eBay Condition ID → ConditionEnum mapping
   * Source: https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum
   */
  CONDITION_ID_TO_ENUM = {
    1000: "NEW",
    1500: "NEW_OTHER",
    1750: "NEW_WITH_DEFECTS",
    2000: "CERTIFIED_REFURBISHED",
    2010: "EXCELLENT_REFURBISHED",
    2020: "VERY_GOOD_REFURBISHED",
    2030: "GOOD_REFURBISHED",
    2500: "SELLER_REFURBISHED",
    2750: "LIKE_NEW",
    2990: "PRE_OWNED_EXCELLENT",
    3000: "USED_EXCELLENT",
    3010: "PRE_OWNED_FAIR",
    4000: "USED_VERY_GOOD",
    5000: "USED_GOOD",
    6000: "USED_ACCEPTABLE",
    7000: "FOR_PARTS_OR_NOT_WORKING",
  };

  async suggestCategory({ title, categoryPath = null }, maxRetries = 3) {
    const appToken = await authService.getApplicationToken();

    logger.debug("Suggesting category", { title, categoryPath, maxRetries });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await axios.get(
          `${EBAY_CONFIG.baseUrl}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions`,
          {
            params: { q: title },
            headers: { Authorization: `Bearer ${appToken}` },
            timeout: 5000,
          },
        );

        const suggestions = res.data.categorySuggestions || [];

        if (!suggestions.length) {
          const error = new Error(
            `No category suggestions found for: ${title}`,
          );
          error.code = "NO_SUGGESTIONS";
          throw error;
        }

        let bestMatch = suggestions[0];

        if (categoryPath) {
          const pathLower = categoryPath.toLowerCase();
          let longestMatch = null;
          let longestLength = 0;

          for (const s of suggestions) {
            const suggestedPath = this._buildCategoryPath(
              s.category,
            ).toLowerCase();

            const overlapLength = this._calculateOverlap(
              pathLower,
              suggestedPath,
            );

            if (overlapLength > longestLength) {
              longestLength = overlapLength;
              longestMatch = s;
            }
          }

          if (longestMatch && longestLength > 0) {
            bestMatch = longestMatch;
            logger.debug("Found best matching category", {
              categoryPath,
              matched: this._buildCategoryPath(longestMatch.category),
              overlapLength: longestLength,
            });
          }
        }

        const parent = bestMatch.category;
        const leafCategoryId = await this.resolveLeafCategory(
          parent.categoryId,
          maxRetries,
        );

        logger.info("Category suggestion successful", {
          categoryId: leafCategoryId,
          categoryName: parent.categoryName,
          attempt: attempt + 1,
        });

        return {
          categoryId: leafCategoryId,
          categoryName: parent.categoryName,
          parentCategoryId: parent.categoryId,
        };
      } catch (error) {
        const isRetryable = this._isRetryableError(error);
        const isLastAttempt = attempt === maxRetries;

        logger.warn("Category suggestion attempt failed", {
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          error: error.message,
          status: error.response?.status,
          code: error.code,
          isRetryable,
          title,
          categoryPath,
        });

        if (!isRetryable || isLastAttempt) {
          logger.error("Category suggestion failed completely", {
            title,
            categoryPath,
            attempts: attempt + 1,
            finalError: error.message,
          });

          const finalError = new Error(
            `Failed to determine category for "${title}" after ${attempt + 1} attempts: ${error.message}`,
          );
          finalError.code = "CATEGORY_RESOLUTION_FAILED";
          finalError.originalError = error;
          throw finalError;
        }

        const delay = Math.pow(2, attempt) * 1000;
        logger.info("Retrying category suggestion", {
          attempt: attempt + 1,
          nextAttempt: attempt + 2,
          delayMs: delay,
        });

        await this._sleep(delay);
      }
    }
  }

  _calculateOverlap(path1, path2) {
    const parts1 = path1.split(">").map((p) => p.trim());
    const parts2 = path2.split(">").map((p) => p.trim());

    let overlap = 0;
    for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
      if (parts1[i] === parts2[i]) overlap++;
      else break;
    }

    return overlap;
  }

  _buildCategoryPath(category) {
    const parts = [];
    let current = category;

    while (current) {
      parts.unshift(current.categoryName);
      current = current.parentCategory;
    }

    return parts.join(" > ");
  }

  async resolveLeafCategory(categoryId, maxRetries = 3) {
    const appToken = await authService.getApplicationToken();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await axios.get(
          `${EBAY_CONFIG.baseUrl}/commerce/taxonomy/v1/category_tree/0/get_category_subtree`,
          {
            params: { category_id: categoryId },
            headers: {
              Authorization: `Bearer ${appToken}`,
            },
            timeout: 5000,
          },
        );

        const root =
          res.data.rootCategoryNode || res.data.categorySubtreeNode || null;

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

          const listableChild = node.childCategoryTreeNodes.find(
            (child) => child.category?.categoryTreeNodeLevel === "LEAF",
          );

          if (listableChild) {
            return findLeaf(listableChild);
          }

          return findLeaf(node.childCategoryTreeNodes[0]);
        };

        const leafId = findLeaf(root);

        if (!leafId || !/^\d+$/.test(leafId)) {
          throw new Error(
            `Invalid leaf category ID resolved: ${leafId} from parent ${categoryId}`,
          );
        }

        logger.info("Leaf category resolved successfully", {
          originalCategory: categoryId,
          leafCategoryId: leafId,
          attempt: attempt + 1,
        });

        return leafId;
      } catch (error) {
        const isRetryable = this._isRetryableError(error);
        const isLastAttempt = attempt === maxRetries;

        logger.warn("Leaf category resolution attempt failed", {
          categoryId,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          error: error.message,
          status: error.response?.status,
          isRetryable,
        });

        if (!isRetryable || isLastAttempt) {
          logger.error("Leaf category resolution failed completely", {
            categoryId,
            attempts: attempt + 1,
            finalError: error.message,
          });

          const finalError = new Error(
            `Failed to resolve leaf category for ${categoryId} after ${attempt + 1} attempts: ${error.message}`,
          );
          finalError.code = "LEAF_RESOLUTION_FAILED";
          finalError.originalError = error;
          throw finalError;
        }

        const delay = Math.pow(2, attempt) * 1000;
        logger.info("Retrying leaf category resolution", {
          categoryId,
          attempt: attempt + 1,
          nextAttempt: attempt + 2,
          delayMs: delay,
        });

        await this._sleep(delay);
      }
    }
  }

  async getCategoryAspects(categoryId, maxRetries = 3) {
    const appToken = await authService.getApplicationToken();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await axios.get(
          `${EBAY_CONFIG.baseUrl}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category`,
          {
            params: { category_id: categoryId },
            headers: {
              Authorization: `Bearer ${appToken}`,
            },
            timeout: 5000,
          },
        );

        logger.debug("Category aspects retrieved successfully", {
          categoryId,
          aspectCount: res.data.aspects?.length || 0,
          attempt: attempt + 1,
        });

        if (res.data.aspects) {
          logger.debug("Aspect names for debugging", {
            categoryId,
            aspectNames: res.data.aspects.slice(0, 10).map((a) => ({
              name: a.localizedAspectName,
              required: a.aspectConstraint?.aspectRequired,
              hasValues: !!a.aspectValues,
            })),
          });
        }

        return res.data;
      } catch (error) {
        const isRetryable = this._isRetryableError(error);
        const isLastAttempt = attempt === maxRetries;

        logger.warn("Category aspects retrieval attempt failed", {
          categoryId,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          error: error.message,
          status: error.response?.status,
          isRetryable,
        });

        if (!isRetryable || isLastAttempt) {
          logger.error("Category aspects retrieval failed completely", {
            categoryId,
            attempts: attempt + 1,
            finalError: error.message,
          });

          const finalError = new Error(
            `Failed to retrieve aspects for category ${categoryId} after ${attempt + 1} attempts: ${error.message}`,
          );
          finalError.code = "ASPECTS_RETRIEVAL_FAILED";
          finalError.originalError = error;
          throw finalError;
        }

        const delay = Math.pow(2, attempt) * 1000;
        logger.info("Retrying category aspects retrieval", {
          categoryId,
          delayMs: delay,
        });

        await this._sleep(delay);
      }
    }
  }

  /**
   * ✅ UPDATED: Get valid condition enums for a category using metadata API
   * @param {string} categoryId - eBay category ID
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<Object>} {
   *   validEnums: string[],
   *   conditionMappings: Array<{id, description, enum}>,
   *   validDescriptions: string[]
   * }
   */
  async getCategoryConditionMetadata(categoryId, maxRetries = 3) {
    const appToken = await authService.getApplicationToken();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await axios.get(
          `${EBAY_CONFIG.baseUrl}/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies`,
          {
            params: { filter: `categoryIds:{${categoryId}}` },
            headers: {
              Authorization: `Bearer ${appToken}`,
            },
            timeout: 5000,
          },
        );

        const policies = res.data.itemConditionPolicies || [];

        if (policies.length > 0 && policies[0].conditionIds) {
          // ✅ Map condition IDs to enums
          const conditionMappings = policies[0].conditionIds.map((c) => ({
            id: c.conditionId,
            description: c.conditionDescription,
            enum: this._conditionIdToEnum(c.conditionId),
          }));

          const validEnums = conditionMappings.map((c) => c.enum);
          const validDescriptions = conditionMappings.map((c) => c.description);

          logger.info("Category condition metadata retrieved", {
            categoryId,
            conditionMappings,
            validEnums,
            attempt: attempt + 1,
          });

          return {
            validEnums,
            conditionMappings,
            validDescriptions,
          };
        }

        logger.warn("No condition metadata found for category", {
          categoryId,
          attempt: attempt + 1,
        });

        // ✅ Return default with proper structure
        return {
          validEnums: ["NEW", "USED_EXCELLENT", "FOR_PARTS_OR_NOT_WORKING"],
          conditionMappings: [
            { id: 1000, description: "New", enum: "NEW" },
            { id: 3000, description: "Used", enum: "USED_EXCELLENT" },
            {
              id: 7000,
              description: "For parts or not working",
              enum: "FOR_PARTS_OR_NOT_WORKING",
            },
          ],
          validDescriptions: ["New", "Used", "For parts or not working"],
        };
      } catch (error) {
        const isRetryable = this._isRetryableError(error);
        const isLastAttempt = attempt === maxRetries;

        if (!isRetryable || isLastAttempt) {
          logger.warn("Failed to fetch condition metadata", {
            categoryId,
            error: error.message,
            attempts: attempt + 1,
          });

          // ✅ Fallback with proper structure
          return {
            validEnums: ["NEW", "USED_EXCELLENT", "FOR_PARTS_OR_NOT_WORKING"],
            conditionMappings: [
              { id: 1000, description: "New", enum: "NEW" },
              { id: 3000, description: "Used", enum: "USED_EXCELLENT" },
              {
                id: 7000,
                description: "For parts or not working",
                enum: "FOR_PARTS_OR_NOT_WORKING",
              },
            ],
            validDescriptions: ["New", "Used", "For parts or not working"],
          };
        }

        const delay = Math.pow(2, attempt) * 1000;
        await this._sleep(delay);
      }
    }
  }

  /**
   * ✅ NEW: Convert condition ID to ConditionEnum
   * @param {number} conditionId - eBay condition ID
   * @returns {string} ConditionEnum value
   */
  _conditionIdToEnum(conditionId) {
    const enumValue = this.CONDITION_ID_TO_ENUM[conditionId];

    if (!enumValue) {
      logger.warn("Unknown condition ID, defaulting to USED_GOOD", {
        conditionId,
      });
      return "USED_GOOD";
    }

    return enumValue;
  }

  /**
   * ✅ NEW: Map user/AI condition to valid category-specific enum
   * @param {string} userCondition - User/AI-provided condition (e.g., "Good", "Used", "USED_GOOD")
   * @param {Object} categoryMetadata - Result from getCategoryConditionMetadata
   * @returns {string} Valid ConditionEnum for this category
   */
  mapConditionForCategory(userCondition, categoryMetadata) {
    const { validEnums, conditionMappings } = categoryMetadata;

    if (!userCondition) {
      logger.warn("No condition provided, using first valid enum");
      return validEnums[0] || "USED_EXCELLENT";
    }

    // ✅ 1. Check if already a valid enum
    if (validEnums.includes(userCondition)) {
      logger.info("Condition already valid", { userCondition });
      return userCondition;
    }

    // ✅ 2. Try to match by description (case-insensitive)
    const lower = userCondition.toLowerCase().trim();
    const matchByDescription = conditionMappings.find(
      (c) => c.description.toLowerCase() === lower,
    );

    if (matchByDescription) {
      logger.info("Matched condition by description", {
        input: userCondition,
        matched: matchByDescription.enum,
        description: matchByDescription.description,
      });
      return matchByDescription.enum;
    }

    // ✅ 3. Try partial/fuzzy matching
    const fuzzyMatch = this._fuzzyMatchCondition(
      lower,
      validEnums,
      conditionMappings,
    );

    if (fuzzyMatch) {
      logger.info("Fuzzy matched condition", {
        input: userCondition,
        matched: fuzzyMatch,
      });
      return fuzzyMatch;
    }

    // ✅ 4. Fallback to safest valid condition
    const fallback = this._selectFallbackCondition(validEnums);

    logger.warn("No match found, using fallback", {
      input: userCondition,
      fallback,
      validEnums,
    });

    return fallback;
  }

  /**
   * ✅ NEW: Fuzzy match condition to valid enums
   * @private
   */
  _fuzzyMatchCondition(conditionLower, validEnums, conditionMappings) {
    // Check descriptions for partial matches
    for (const mapping of conditionMappings) {
      const desc = mapping.description.toLowerCase();

      // Exact substring match
      if (desc.includes(conditionLower) || conditionLower.includes(desc)) {
        return mapping.enum;
      }
    }

    // Pattern-based matching
    const patterns = {
      new: ["NEW", "NEW_OTHER", "NEW_WITH_DEFECTS", "LIKE_NEW"],
      "like new": ["LIKE_NEW", "NEW", "USED_EXCELLENT"],
      excellent: ["USED_EXCELLENT", "EXCELLENT_REFURBISHED"],
      "very good": ["USED_VERY_GOOD", "VERY_GOOD_REFURBISHED"],
      good: ["USED_GOOD", "GOOD_REFURBISHED", "USED_VERY_GOOD"],
      acceptable: ["USED_ACCEPTABLE", "USED_GOOD"],
      fair: ["PRE_OWNED_FAIR", "USED_ACCEPTABLE"],
      used: ["USED_EXCELLENT", "USED_VERY_GOOD", "USED_GOOD"],
      "pre-owned": ["PRE_OWNED_EXCELLENT", "USED_EXCELLENT", "PRE_OWNED_FAIR"],
      "pre owned": ["PRE_OWNED_EXCELLENT", "USED_EXCELLENT"],
      parts: ["FOR_PARTS_OR_NOT_WORKING"],
      "not working": ["FOR_PARTS_OR_NOT_WORKING"],
      broken: ["FOR_PARTS_OR_NOT_WORKING"],
      refurbished: [
        "CERTIFIED_REFURBISHED",
        "EXCELLENT_REFURBISHED",
        "SELLER_REFURBISHED",
      ],
      certified: ["CERTIFIED_REFURBISHED"],
    };

    // Try pattern matching
    for (const [keyword, preferredEnums] of Object.entries(patterns)) {
      if (conditionLower.includes(keyword)) {
        for (const enumValue of preferredEnums) {
          if (validEnums.includes(enumValue)) {
            return enumValue;
          }
        }
      }
    }

    return null;
  }

  /**
   * ✅ NEW: Select safest fallback condition from valid enums
   * @private
   */
  _selectFallbackCondition(validEnums) {
    // Preference order: Used variants > New > Parts/Not Working
    const preferences = [
      "USED_EXCELLENT",
      "USED_GOOD",
      "USED_VERY_GOOD",
      "USED_ACCEPTABLE",
      "NEW",
      "LIKE_NEW",
      "FOR_PARTS_OR_NOT_WORKING",
    ];

    for (const pref of preferences) {
      if (validEnums.includes(pref)) {
        return pref;
      }
    }

    // Last resort: first available
    return validEnums[0] || "USED_GOOD";
  }

  _isRetryableError(error) {
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return true;
    }

    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    if (
      error.response?.status &&
      retryableStatuses.includes(error.response.status)
    ) {
      return true;
    }

    if (error.code === "NO_SUGGESTIONS") {
      return false;
    }

    return false;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new TaxonomyService();
