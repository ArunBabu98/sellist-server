const axios = require('axios');
const EBAY_CONFIG = require('../../../config/ebay.config');
const config = require('../../../config');
const logger = require('../../../config/logger.config');

class ListingService {
  async publishListing(accessToken, listingData) {
    let {
      sku,
      title,
      description,
      price,
      currency,
      condition,
      quantity,
      imageUrls,
      categoryId,
      itemSpecifics,
      shippingWeight,
      flaws,
      seoKeywords,
    } = listingData;

    // Validate category ID
    if (!categoryId || !/^\d+$/.test(categoryId)) {
      logger.warn('Invalid category ID, using default 220');
      categoryId = '220';
    }

    // Create inventory item
    const productData = {
      title: title,
      description: description,
      ...(imageUrls &&
        imageUrls.length > 0 && {
          imageUrls: imageUrls
            .filter((url) => url.startsWith('http'))
            .slice(0, 12),
        }),
    };

    if (itemSpecifics && Object.keys(itemSpecifics).length > 0) {
      const aspects = {};
      for (const [key, value] of Object.entries(itemSpecifics)) {
        aspects[key] = Array.isArray(value) ? value : [String(value)];
      }
      productData.aspects = aspects;
    }

    if (itemSpecifics?.Brand) {
      productData.brand = itemSpecifics.Brand;
      productData.mpn = itemSpecifics?.MPN || 'Does Not Apply';
    }

    if (itemSpecifics?.UPC && itemSpecifics.UPC !== 'Does Not Apply') {
      productData.upc = Array.isArray(itemSpecifics.UPC)
        ? itemSpecifics.UPC
        : [itemSpecifics.UPC];
    }

    const inventoryItemPayload = {
      availability: {
        shipToLocationAvailability: { quantity: quantity || 1 },
      },
      condition: condition || 'USED_EXCELLENT',
      product: productData,
    };

    await axios.put(
      `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/inventory_item/${sku}`,
      inventoryItemPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Language': 'en-US',
        },
      }
    );

    logger.info('Inventory item created', { sku });

    // Build full description
    let fullDescription = description;
    if (flaws && flaws.length > 0) {
      fullDescription += '\n\n<h3>Item Condition Notes:</h3><ul>';
      flaws.forEach((flaw) => {
        fullDescription += `<li>${flaw}</li>`;
      });
      fullDescription += '</ul>';
    }

    if (seoKeywords && seoKeywords.length > 0) {
      fullDescription += `\n\n<p><small>Keywords: ${seoKeywords.join(
        ', '
      )}</small></p>`;
    }

    // Create offer
    const offerPayload = {
      sku: sku,
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE',
      listingDescription: fullDescription,
      availableQuantity: quantity || 1,
      categoryId: categoryId,
      merchantLocationKey: 'default_location',
      listingPolicies: {
        fulfillmentPolicyId: config.ebay.fulfillmentPolicyId,
        paymentPolicyId: config.ebay.paymentPolicyId,
        returnPolicyId: config.ebay.returnPolicyId,
      },
      pricingSummary: {
        price: {
          value: price.toString(),
          currency: currency || 'USD',
        },
      },
    };

    if (shippingWeight) {
      offerPayload.shippingPackageDetails = {
        packageWeightAndSize: {
          weight: {
            value: parseFloat(shippingWeight) || 1,
            unit: 'OUNCE',
          },
        },
      };
    }

    const offerResponse = await axios.post(
      `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/offer`,
      offerPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Language': 'en-US',
        },
      }
    );

    const offerId = offerResponse.data.offerId;
    logger.info('Offer created', { offerId });

    // Publish offer
    const publishResponse = await axios.post(
      `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/offer/${offerId}/publish`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Language': 'en-US',
        },
      }
    );

    const listingId = publishResponse.data.listingId;

    return {
      success: true,
      listingId: listingId,
      offerId: offerId,
      sku: sku,
      categoryId: categoryId,
    };
  }
}

module.exports = new ListingService();
