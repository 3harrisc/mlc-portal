const telegram = require("./telegram");

let digestQueue = [];

function add(email) {
  digestQueue.push(email);
}

async function flush() {
  if (digestQueue.length === 0) {
    console.log("Digest: no emails to send");
    return;
  }

  console.log(`Digest: sending ${digestQueue.length} email(s)`);
  await telegram.sendDigest(digestQueue);
  digestQueue = [];
}

function count() {
  return digestQueue.length;
}

module.exports = { add, flush, count };
