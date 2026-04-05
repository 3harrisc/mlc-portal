const https = require("https");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function send(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${TOKEN}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Telegram ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function formatEmail(email, label) {
  const from = escapeHtml(email.from || "Unknown");
  const subject = escapeHtml(email.subject || "(no subject)");
  const account = escapeHtml(email.account || "");
  const snippet = escapeHtml((email.body || "").slice(0, 300));

  return [
    `<b>${label}</b>`,
    `📧 <b>From:</b> ${from}`,
    `📋 <b>Subject:</b> ${subject}`,
    `📬 <b>Account:</b> ${account}`,
    "",
    snippet,
  ].join("\n");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendAlert(email, label) {
  const msg = formatEmail(email, label);
  return send(msg);
}

async function sendDigest(emails) {
  if (!emails.length) return;

  const header = `<b>📬 Email Digest — ${emails.length} email(s)</b>\n`;
  const items = emails.map((e, i) => {
    const from = escapeHtml(e.from || "Unknown");
    const subject = escapeHtml(e.subject || "(no subject)");
    const account = escapeHtml(e.account || "");
    return `${i + 1}. <b>${from}</b>\n   ${subject}\n   <i>${account}</i>`;
  });

  // Telegram has a 4096 char limit — split if needed
  let message = header;
  for (const item of items) {
    if (message.length + item.length + 2 > 4000) {
      await send(message);
      message = "<b>📬 Digest (continued)</b>\n";
    }
    message += "\n" + item;
  }
  await send(message);
}

async function sendStartup() {
  return send("✅ Email Agent Started");
}

module.exports = { send, sendAlert, sendDigest, sendStartup };
