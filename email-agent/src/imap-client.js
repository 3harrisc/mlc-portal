const Imap = require("imap");
const { simpleParser } = require("mailparser");

const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_PORT = parseInt(process.env.IMAP_PORT || "993", 10);
const IMAP_TLS = process.env.IMAP_TLS !== "false";

function getAccounts() {
  const accounts = [];
  for (let i = 1; i <= 4; i++) {
    const email = process.env[`MLC_EMAIL_${i}`];
    const pass = process.env[`MLC_PASS_${i}`];
    if (email && pass) {
      accounts.push({ email, pass });
    }
  }
  return accounts;
}

function fetchFromAccount(email, pass) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: email,
      password: pass,
      host: IMAP_HOST,
      port: IMAP_PORT,
      tls: IMAP_TLS,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30_000,
      authTimeout: 15_000,
    });

    const emails = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        imap.search(["UNSEEN"], (err, uids) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          if (!uids || uids.length === 0) {
            imap.end();
            return resolve([]);
          }

          const fetch = imap.fetch(uids, { bodies: "", markSeen: true });

          fetch.on("message", (msg) => {
            let buffer = "";

            msg.on("body", (stream) => {
              stream.on("data", (chunk) => (buffer += chunk.toString()));
            });

            msg.once("end", async () => {
              try {
                const parsed = await simpleParser(buffer);
                emails.push({
                  id: parsed.messageId || `${Date.now()}-${Math.random()}`,
                  subject: parsed.subject || "",
                  from: parsed.from?.value?.[0]?.address || "",
                  fromName: parsed.from?.value?.[0]?.name || "",
                  body: parsed.text || parsed.html?.replace(/<[^>]+>/g, "") || "",
                  date: parsed.date?.toISOString() || new Date().toISOString(),
                  account: email,
                  source: "imap",
                  raw: buffer,
                });
              } catch (parseErr) {
                console.error(`Parse error for ${email}:`, parseErr.message);
              }
            });
          });

          fetch.once("end", () => {
            imap.end();
          });

          fetch.once("error", (fetchErr) => {
            console.error(`Fetch error for ${email}:`, fetchErr.message);
            imap.end();
          });
        });
      });
    });

    imap.once("error", (err) => {
      console.error(`IMAP error for ${email}:`, err.message);
      resolve([]);
    });

    imap.once("end", () => {
      resolve(emails);
    });

    imap.connect();
  });
}

async function fetchAllUnread() {
  const accounts = getAccounts();
  if (!accounts.length) return [];

  const results = await Promise.allSettled(
    accounts.map((a) => fetchFromAccount(a.email, a.pass))
  );

  const emails = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      emails.push(...result.value);
    }
  }
  return emails;
}

module.exports = { fetchAllUnread };
