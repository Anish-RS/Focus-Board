// Purely a display convenience: shows an approximate native-currency estimate next to the
// INR price, guessed from the visitor's browser locale, so people outside India have a
// familiar reference point. It never changes what's actually charged -- Razorpay always
// bills in INR regardless of what's shown here, and if the guess or the exchange-rate
// lookup fails for any reason, the plain "\u20b9249/month" text (already in the HTML)
// is simply left as-is.
(function (global) {
  "use strict";
  var STB = (global.STB = global.STB || {});

  STB.PRICE_INR = 249;

  // Small region -> currency table covering the most common regions. Not exhaustive --
  // anywhere not listed here (including India itself) just shows the INR price with no
  // conversion, which is the correct/simplest thing for a region we're not confident about.
  var REGION_CURRENCY = {
    US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR",
    AE: "AED", SA: "SAR", SG: "SGD", MY: "MYR", ID: "IDR", PH: "PHP", TH: "THB", VN: "VND",
    JP: "JPY", KR: "KRW", CN: "CNY", HK: "HKD", TW: "TWD",
    ZA: "ZAR", NG: "NGN", KE: "KES", EG: "EGP",
    BR: "BRL", MX: "MXN", AR: "ARS",
    PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR",
    RU: "RUB", TR: "TRY", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN",
  };

  var CACHE_KEY = "stb_currency_cache_v1";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000; // a day-old rate is plenty fresh for a rough estimate
  var RATE_API = "https://open.er-api.com/v6/latest/INR"; // free, no key required

  function detectCurrency() {
    try {
      var locale = navigator.language || navigator.userLanguage || "en-IN";
      var region = locale.split("-")[1];
      return region ? REGION_CURRENCY[region.toUpperCase()] || null : null;
    } catch (e) {
      return null;
    }
  }

  function readCache() {
    try {
      var raw = global.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.assign({ fetchedAt: Date.now() }, data)));
    } catch (e) {}
  }

  function formatNative(currency, rate) {
    var amount = STB.PRICE_INR * rate;
    try {
      return new Intl.NumberFormat(navigator.language || "en", {
        style: "currency",
        currency: currency,
        maximumFractionDigits: amount < 10 ? 2 : 0,
      }).format(amount);
    } catch (e) {
      return amount.toFixed(2) + " " + currency;
    }
  }

  // Returns e.g. " (~$3.00)", or "" if we don't have a usable rate yet -- callers should
  // always work fine with "" (that's the state before the first fetch resolves, or forever,
  // for a region we don't recognize or an offline visitor).
  STB.getPriceSuffix = function () {
    var cache = readCache();
    if (!cache || !cache.currency || !cache.rate) return "";
    return " (~" + formatNative(cache.currency, cache.rate) + ")";
  };

  function updateDom() {
    var suffix = STB.getPriceSuffix();
    var nodes = document.querySelectorAll("[data-stb-price-native]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = suffix;
    // app.html's upgrade buttons/banner are rendered dynamically by sync.js -- if that's
    // loaded on this page, ask it to re-render now that a rate is available.
    if (typeof STB.renderAuthUI === "function") {
      try { STB.renderAuthUI(); } catch (e) {}
    }
  }

  function refresh() {
    var currency = detectCurrency();
    if (!currency) return; // unrecognized region (or India) -- INR-only is correct here
    var cached = readCache();
    if (cached && cached.currency === currency) { updateDom(); return; }
    fetch(RATE_API)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var rate = data && data.rates && data.rates[currency];
        if (!rate) return;
        writeCache({ currency: currency, rate: rate });
        updateDom();
      })
      .catch(function () { /* silent -- the plain INR price is accurate on its own */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})(window);
