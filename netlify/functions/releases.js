const { connectLambda } = require('@netlify/blobs');
const { getAllReleases } = require('../../lib/storage/releaseStore');

exports.handler = async function (event) {
  connectLambda(event);

  try {
    const releases = await getAllReleases();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ releases }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
