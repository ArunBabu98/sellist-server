const config = require("./index");

const EBAY_CONFIG = {
  clientId: config.ebay.appId,
  clientSecret: config.ebay.certId,
  redirectUri: config.ebay.redirectUri,
  useSandbox: config.ebay.useSandbox,

  get tokenUrl() {
    return this.useSandbox
      ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
      : "https://api.ebay.com/identity/v1/oauth2/token";
  },

  get authUrl() {
    return this.useSandbox
      ? "https://auth.sandbox.ebay.com/oauth2/authorize"
      : "https://auth.ebay.com/oauth2/authorize";
  },

  get baseUrl() {
    return this.useSandbox
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";
  },

  get mediaBaseUrl() {
    return this.useSandbox
      ? "https://apim.sandbox.ebay.com"
      : "https://apim.ebay.com";
  },

  get identityUrl() {
    return this.useSandbox
      ? "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/"
      : "https://apiz.ebay.com/commerce/identity/v1/user/";
  },

  scopes: [
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
  ].join(" "),
};

module.exports = EBAY_CONFIG;
