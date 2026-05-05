/**
 * src/middleware/cors.js — CORS 中间件
 */

function createCorsMiddleware(ENV, ALLOWED_ORIGINS) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (ENV === 'development') {
      res.header('Access-Control-Allow-Origin', '*');
    } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  };
}

module.exports = { createCorsMiddleware };