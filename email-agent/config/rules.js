module.exports = {
  // ── VIP senders (instant Telegram alert) ───────────────
  vipDomains: [
    "ashwood.co.uk",
    "haytoncoulthard.co.uk",
  ],

  vipAddresses: [
    // Add specific email addresses here
    // "john@example.com",
  ],

  // ── Invoice / bill keywords ────────────────────────────
  invoiceKeywords: [
    "invoice",
    "bill",
    "statement",
    "payment due",
    "amount due",
    "remittance",
    "account summary",
    "overdue",
  ],

  // ── Job / booking confirmation keywords ────────────────
  jobKeywords: [
    "job confirmation",
    "booking confirmation",
    "collection confirmed",
    "delivery confirmed",
    "order confirmed",
    "pickup scheduled",
    "delivery scheduled",
    "consignment",
    "shipment confirmed",
  ],

  // ── Urgent keywords (instant alert) ────────────────────
  urgentKeywords: [
    "complaint",
    "legal",
    "solicitor",
    "dvsa",
    "tribunal",
    "court",
    "urgent",
    "emergency",
    "accident",
    "incident",
    "recall",
    "safety notice",
  ],

  // ── Ignored domains (skip entirely) ────────────────────
  ignoredDomains: [
    "zieglergroup.com",
  ],

  // ── Digest schedule (cron expressions) ─────────────────
  digestTimes: [
    "30 7 * * *",   // 7:30 AM
    "0 12 * * *",   // 12:00 PM
    "0 16 * * *",   // 4:00 PM
  ],

  // ── Poll interval (minutes) ────────────────────────────
  pollIntervalMinutes: 2,
};
