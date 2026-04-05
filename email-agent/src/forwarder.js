const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

async function forward(email, destination, label) {
  try {
    const transport = getTransporter();

    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: destination,
      subject: `[${label}] Fwd: ${email.subject}`,
      text: [
        `Forwarded by Email Agent`,
        `Category: ${label}`,
        `Original From: ${email.from} (${email.fromName})`,
        `Original Date: ${email.date}`,
        `Account: ${email.account}`,
        `---`,
        email.body || "(no body)",
      ].join("\n"),
      ...(email.raw
        ? {
            attachments: [
              {
                filename: "original.eml",
                content: email.raw,
                contentType: "message/rfc822",
              },
            ],
          }
        : {}),
    });

    console.log(`Forwarded to ${destination}: ${email.subject}`);
  } catch (err) {
    console.error(`Forward error to ${destination}:`, err.message);
  }
}

async function forwardToXero(email) {
  const dest = process.env.XERO_FORWARD_EMAIL;
  if (!dest) {
    console.warn("XERO_FORWARD_EMAIL not set, skipping forward");
    return;
  }
  return forward(email, dest, "Invoice");
}

async function forwardToPortal(email) {
  const dest = process.env.PORTAL_FORWARD_EMAIL;
  if (!dest) {
    console.warn("PORTAL_FORWARD_EMAIL not set, skipping forward");
    return;
  }
  return forward(email, dest, "Job Confirmation");
}

module.exports = { forwardToXero, forwardToPortal };
