const { connectLambda } = require('@netlify/blobs');
const { rebuildIndexFromRawScan } = require('../../lib/storage/releaseStore');

exports.handler = async function (event) {
  connectLambda(event);

  try {
    const result = await rebuildIndexFromRawScan();
    console.log(`Release index rebuilt: scanned ${result.scanned}, indexed ${result.indexed}.`);
  } catch (err) {
    console.error('Release index rebuild failed:', err);
  }

  return { statusCode: 200 };
};