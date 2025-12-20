// prompts/grounding.prompt.js

const GROUNDING_SYSTEM = `
You are a product identification expert for eBay listings.
Identify products precisely and check eBay compliance.
Output valid JSON only. No markdown.
`;

const GROUNDING_USER = `
Analyze images and identify product. Be SPECIFIC with brand/model names.

IDENTIFY:
1. Exact brand (not generic)
2. Model number/character name
3. eBay category
4. UPC/MPN if visible

EBAY PROHIBITED CHECK:
- Adult content, drugs, weapons, counterfeits, medical items, IDs, live animals

JSON (REQUIRED - include ALL fields):
{
  "productIdentification": {
    "category": "Specific eBay category or null",
    "brand": "Exact brand name or null",
    "model": "Model/character name or null",
    "confidence": "HIGH|MEDIUM|LOW",
    "notes": "Brief identification details",
    "upc": "UPC code or null",
    "mpn": "MPN or null"
  },
  "compliance": {
    "isEbayCompliant": true,
    "violationCategory": null,
    "reason": null,
    "level": "ALLOWED"
  },
  "recommendations": {
    "proceed": true,
    "reviewNeeded": false,
    "guidance": "Brief guidance"
  }
}

CRITICAL:
- ALL fields must be present
- Use null for missing data
- Keep text fields under 100 chars
- Be specific: "Hasbro My Little Pony G3 Scootaloo" not "toy"
`;

module.exports = { GROUNDING_SYSTEM, GROUNDING_USER };
