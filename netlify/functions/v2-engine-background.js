const { connectLambda } = require('@netlify/blobs');
const { runEngine } = require('../../lib/v2/engine');

exports.handler = async function (event) {
  connectLambda(event);
  try {
    const result = await runEngine();
    console.log('Transmission V2 engine:', result);
  } catch (err) {
    console.error('Transmission V2 engine failed:', err);
  }
  return { statusCode: 200 };
};
