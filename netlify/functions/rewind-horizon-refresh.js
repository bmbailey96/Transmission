exports.handler=async()=>{const r=await fetch(process.env.URL+'/.netlify/functions/rewind-horizon-refresh-background',{method:'POST'});return {statusCode:r.status===202?200:502};};
