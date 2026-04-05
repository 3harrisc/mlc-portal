const https = require("https");

const TENANT_ID = process.env.MONTPELLIER_TENANT_ID;
const CLIENT_ID = process.env.MONTPELLIER_CLIENT_ID;
const CLIENT_SECRET = process.env.MONTPELLIER_CLIENT_SECRET;
const USER_EMAIL = process.env.MONTPELLIER_EMAIL;

let accessToken = null;
let tokenExpiry = 0;

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  if (accessToken && Date.now() < tokenExpiry - 60_000) {
    return accessToken;
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: "https://graph.microsoft.com/.default",
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
  }).toString();

  const res = await httpsRequest(
    {
      hostname: "login.microsoftonline.com",
      path: `/${TENANT_ID}/oauth2/v2.0/token`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );

  if (res.status !== 200) {
    throw new Error(`Graph token error: ${JSON.stringify(res.data)}`);
  }

  accessToken = res.data.access_token;
  tokenExpiry = Date.now() + res.data.expires_in * 1000;
  return accessToken;
}

async function graphGet(path) {
  const token = await getToken();
  const res = await httpsRequest({
    hostname: "graph.microsoft.com",
    path,
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status !== 200) {
    throw new Error(`Graph GET ${path}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

async function graphPatch(path, body) {
  const token = await getToken();
  const json = JSON.stringify(body);
  const res = await httpsRequest(
    {
      hostname: "graph.microsoft.com",
      path,
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(json),
      },
    },
    json
  );
  return res;
}

async function fetchUnreadEmails() {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !USER_EMAIL) {
    return [];
  }

  try {
    const path =
      `/v1.0/users/${encodeURIComponent(USER_EMAIL)}/messages` +
      `?$filter=isRead eq false` +
      `&$top=50` +
      `&$select=id,subject,from,bodyPreview,receivedDateTime` +
      `&$orderby=receivedDateTime desc`;

    const data = await graphGet(path);
    const emails = (data.value || []).map((msg) => ({
      id: msg.id,
      subject: msg.subject || "",
      from: msg.from?.emailAddress?.address || "",
      fromName: msg.from?.emailAddress?.name || "",
      body: msg.bodyPreview || "",
      date: msg.receivedDateTime,
      account: USER_EMAIL,
      source: "graph",
    }));

    return emails;
  } catch (err) {
    console.error("Graph fetch error:", err.message);
    return [];
  }
}

async function markAsRead(messageId) {
  try {
    await graphPatch(
      `/v1.0/users/${encodeURIComponent(USER_EMAIL)}/messages/${messageId}`,
      { isRead: true }
    );
  } catch (err) {
    console.error("Graph mark-read error:", err.message);
  }
}

module.exports = { fetchUnreadEmails, markAsRead };
