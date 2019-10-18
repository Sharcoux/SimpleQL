const RateLimit = require('express-rate-limit');
const compose = require('compose-middleware').compose;
const helmet = require('helmet');

/** Limit the amount of request the server should handle per minute */
const apiLimiter = new RateLimit({
  windowMs: 60*1000, // 1 minute
  max: 100,
});

/** Redirects all requests to https */
function requireHTTPS(req, res, next) {
    if (!req.secure && process.env.NODE_ENV !== "development") {
        return res.redirect('https://' + req.get('host') + req.url);
    }
    next();
}

const securityPlugin = {
    middleware: compose([apiLimiter, requireHTTPS, helmet()]),
}

module.exports = securityPlugin;