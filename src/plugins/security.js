const { security : securityModel } = require('../utils/types');
const check = require('../utils/type-checking');
const log = require('../utils/logger');
const { getOptionalDep } = require('../utils');

const createSecurityPlugin = config => {
  check(securityModel, config);
  const {app, domains, emailACME, requestPerMinute, helmet : helmetConfig } = config;
  const RateLimit = getOptionalDep('express-rate-limit', 'SecurityPlugin');
  const cm = getOptionalDep('compose-middleware', 'SecurityPlugin');
  const helmet = getOptionalDep('helmet', 'SecurityPlugin');
  const greenlock = getOptionalDep('greenlock-express', 'SecurityPlugin');
  const greenlockStore = getOptionalDep('greenlock-store-fs', 'SecurityPlugin');
    
  /** Limit the amount of request the server should handle per minute */
  const apiLimiter = new RateLimit({
    windowMs: 60*1000, // 1 minute
    max: requestPerMinute || 1000,
  });
  
  /** Redirects all requests to https */
  function requireHTTPS(req, res, next) {//eslint-disable-line no-unused-vars
    if (!req.secure && process.env.NODE_ENV !== 'development') {
      return res.redirect('https://' + req.get('host') + req.url);
    }
    next();
  }
  
  log('warning', 'NOTICE:\nDo not call app.listen() when using the securityPlugin.\nPorts will be 80 and 443 and this cannot be changed. Run `sudo setcap \'cap_net_bind_service=+ep\' $(which node)` in order to use these ports with non without root access.');
  greenlock
    .create({
      email: emailACME, // The email address of the ACME user / hosting provider
      agreeTos: true, // You must accept the ToS as the host which handles the certs
      configDir: '~/.config/acme/', // Writable directory where certs will be saved
      telemetry: true, // Contribute telemetry data to the projec
      store: greenlockStore,
      approveDomains: domains,
      // Using your express app:
      // simply export it as-is, then include it here
      app
      //, debug: true
    })
    .listen(80, 443);
  return {
    middleware: requestPerMinute ? cm.compose([apiLimiter, helmet(helmetConfig)]) : helmet(helmetConfig)
  };
};

module.exports = createSecurityPlugin;