require("dotenv/config");

const cron = require("node-cron");
const rules = require("../config/rules");
const graph = require("./graph-client");
const imap = require("./imap-client");
const classifier = require("./classifier");
const telegram = require("./telegram");
const forwarder = require("./forwarder");
const digest = require("./digest");

const processedIds = new Set();
const MAX_PROCESSED = 10_000;

async function pollEmails() {
  console.log(`[${new Date().toISOString()}] Polling emails...`);

  // Fetch from all sources in parallel
  const [graphEmails, imapEmails] = await Promise.all([
    graph.fetchUnreadEmails(),
    imap.fetchAllUnread(),
  ]);

  const allEmails = [...graphEmails, ...imapEmails];
  console.log(`Found ${allEmails.length} unread email(s)`);

  for (const email of allEmails) {
    // Skip already processed
    if (processedIds.has(email.id)) continue;
    processedIds.add(email.id);

    // Keep set from growing forever
    if (processedIds.size > MAX_PROCESSED) {
      const first = processedIds.values().next().value;
      processedIds.delete(first);
    }

    try {
      const result = await classifier.classify(email);
      console.log(
        `  [${result.category}] ${email.from}: ${email.subject} — ${result.reason}`
      );

      switch (result.category) {
        case "invoice":
          await Promise.all([
            forwarder.forwardToXero(email),
            telegram.sendAlert(email, "🧾 Invoice / Bill"),
          ]);
          break;

        case "job":
          await Promise.all([
            forwarder.forwardToPortal(email),
            telegram.sendAlert(email, "📦 Job Confirmation"),
          ]);
          break;

        case "vip":
          await telegram.sendAlert(email, "⭐ VIP Sender");
          break;

        case "urgent":
          await telegram.sendAlert(email, "🚨 URGENT");
          break;

        case "ignored":
          break;

        default:
          digest.add(email);
          break;
      }

      // Mark Graph emails as read
      if (email.source === "graph") {
        await graph.markAsRead(email.id);
      }
    } catch (err) {
      console.error(`Error processing email ${email.id}:`, err.message);
    }
  }
}

async function start() {
  console.log("MLC Email Agent starting...");
  console.log(`Poll interval: ${rules.pollIntervalMinutes} minute(s)`);
  console.log(`Digest times: ${rules.digestTimes.join(", ")}`);

  // Send startup notification
  try {
    await telegram.sendStartup();
  } catch (err) {
    console.error("Telegram startup notification failed:", err.message);
    console.error("Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID");
  }

  // Initial poll
  await pollEmails();

  // Schedule polling
  const cronExpr = `*/${rules.pollIntervalMinutes} * * * *`;
  cron.schedule(cronExpr, pollEmails);
  console.log(`Polling every ${rules.pollIntervalMinutes} minute(s)`);

  // Schedule digest flushes
  for (const time of rules.digestTimes) {
    cron.schedule(time, async () => {
      console.log("Flushing digest...");
      await digest.flush();
    });
  }

  console.log("Email Agent running. Press Ctrl+C to stop.");
}

start().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
