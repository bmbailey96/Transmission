exports.handler = async () => {
  const r = await fetch(`${process.env.URL}/.netlify/functions/rewind-check-background`,{method:'POST'});
  return {statusCode:r.status === 202 ? 200 : 502,body:JSON.stringify({accepted:r.status === 202})};
};
