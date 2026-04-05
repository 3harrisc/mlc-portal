# MLC Email Agent

AI-powered email triage for Montpellier Appliances & MLC Transport.

Monitors 5 email accounts, uses Claude to classify emails, forwards invoices to Xero, job confirmations to the MLC portal, and sends instant Telegram alerts for VIPs and urgent emails. Everything else batches into 7:30am / 12pm / 4pm digests.

---

## What it does

| Email type | Action |
|---|---|
| Invoice / bill / statement | Forward to Xero + instant Telegram alert |
| Job / booking confirmation | Forward to MLC portal + instant Telegram alert |
| From Ashwood or Hayton Coulthard | Instant Telegram alert |
| Urgent (complaints, legal, DVSA etc) | Instant Telegram alert |
| Everything else | Batched into digest (7:30am, 12pm, 4pm) |

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo>
cd mlc-email-agent
npm install
cp .env.example .env
```

### 2. Set up Telegram Bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot` and follow prompts
3. Copy the token into `.env` as `TELEGRAM_BOT_TOKEN`
4. Start your bot (search for it in Telegram, press Start)
5. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
6. Find `"chat":{"id": 123456789}` — put that in `TELEGRAM_CHAT_ID`

### 3. Set up Microsoft Graph (Montpellier Office 365)

1. Go to [portal.azure.com](https://portal.azure.com)
2. **Azure Active Directory → App registrations → New registration**
3. Name it `Email Agent`, leave defaults, click Register
4. Copy the **Application (client) ID** → `MONTPELLIER_CLIENT_ID`
5. Copy the **Directory (tenant) ID** → `MONTPELLIER_TENANT_ID`
6. Go to **Certificates & secrets → New client secret**
7. Copy the secret value → `MONTPELLIER_CLIENT_SECRET`
8. Go to **API permissions → Add permission → Microsoft Graph → Application permissions**
9. Add `Mail.Read` and `Mail.ReadWrite`
10. Click **Grant admin consent**

### 4. Fill in MLC IMAP details

Check your Outlook account settings for the IMAP server address.
In Outlook: File → Account Settings → your account → More settings.

Typical settings:
- Host: `mail.yourdomain.co.uk` or your provider's IMAP server
- Port: `993`
- TLS: `true`

Fill in all 4 account emails and passwords in `.env`.

### 5. SMTP for forwarding

Use one of the MLC accounts as the sending address.
Fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

### 6. Run locally

```bash
npm start
```

You should get a Telegram message: "✅ Email Agent Started"

---

## Deploy to Render

1. Push to a GitHub repo (private is fine)
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect your repo → Render will detect `render.yaml`
4. Add all your environment variables in the Render dashboard
5. Deploy

Render's **worker** type (not web service) stays running 24/7 on the free tier — perfect for this.

---

## Customising rules

Edit `config/rules.js` to:
- Add more VIP domains or addresses
- Add invoice/job confirmation keywords
- Add domains to ignore (newsletters etc)

No need to touch any other files.

---

## Adding more VIP senders

```js
vipDomains: [
  "ashwood.co.uk",
  "haytoncoulthard.co.uk",
  "newcustomer.co.uk",  // ← just add here
],
```

Redeploy after any config changes.
