const Anthropic = require("@anthropic-ai/sdk");
const rules = require("../config/rules");

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an email classifier for a UK transport and appliance company.

Classify each email into exactly ONE category:

- "invoice" — invoices, bills, statements, payment requests, remittance advice
- "job" — ONLY confirmed/accepted jobs or bookings. Must be a definite confirmation, NOT an offer, availability list, or quote. "Available loads", "load board", "jobs available" are NOT confirmations — classify those as "normal"
- "vip" — emails from VIP senders (you'll be told which domains/addresses are VIP)
- "urgent" — complaints, legal threats, DVSA notices, safety recalls, accidents, emergencies
- "normal" — everything else (newsletters, general enquiries, marketing, etc.)

VIP domains: ${rules.vipDomains.join(", ")}
VIP addresses: ${rules.vipAddresses.join(", ") || "none"}

Respond with ONLY a JSON object: {"category": "...", "reason": "..."}
The reason should be one short sentence.`;

async function classify(email) {
  // Check ignored domains first
  const fromDomain = (email.from || "").split("@")[1]?.toLowerCase() || "";
  if (rules.ignoredDomains.includes(fromDomain)) {
    return { category: "ignored", reason: "Domain is in ignore list" };
  }

  // Check VIP by domain/address before calling AI
  if (rules.vipDomains.some((d) => fromDomain === d.toLowerCase())) {
    return { category: "vip", reason: `VIP domain: ${fromDomain}` };
  }
  if (rules.vipAddresses.some((a) => email.from?.toLowerCase() === a.toLowerCase())) {
    return { category: "vip", reason: `VIP address: ${email.from}` };
  }

  // Use Claude for everything else
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `From: ${email.from} (${email.fromName})
Subject: ${email.subject}
Account: ${email.account}

Body (first 500 chars):
${(email.body || "").slice(0, 500)}`,
        },
      ],
    });

    const text = message.content[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return { category: "normal", reason: "Could not parse classifier response" };
  } catch (err) {
    console.error("Classifier error:", err.message);
    // Fall back to keyword matching
    return keywordFallback(email);
  }
}

function keywordFallback(email) {
  const text = `${email.subject} ${email.body}`.toLowerCase();

  for (const kw of rules.urgentKeywords) {
    if (text.includes(kw)) {
      return { category: "urgent", reason: `Keyword match: ${kw}` };
    }
  }
  for (const kw of rules.invoiceKeywords) {
    if (text.includes(kw)) {
      return { category: "invoice", reason: `Keyword match: ${kw}` };
    }
  }
  for (const kw of rules.jobKeywords) {
    if (text.includes(kw)) {
      return { category: "job", reason: `Keyword match: ${kw}` };
    }
  }

  return { category: "normal", reason: "No keyword matches" };
}

module.exports = { classify };
