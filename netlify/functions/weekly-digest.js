const { connectLambda } = require('@netlify/blobs');
const { buildWeeklyDigest } = require('../../lib/digest/buildWeeklyDigest');
const { sendEmail } = require('../../lib/email/sendEmail');

exports.handler = async function (event) {
  connectLambda(event);

  try {
    const { subject, html, count } = await buildWeeklyDigest();
    await sendEmail({ to: process.env.DIGEST_TO_EMAIL, subject, html });
    console.log(`Weekly digest sent. ${count} release(s) included.`);
    return { statusCode: 200, body: `ok — ${count} release(s) sent` };
  } catch (err) {
    console.error('Weekly digest failed:', err.message);
    return { statusCode: 500, body: err.message };
  }
};
