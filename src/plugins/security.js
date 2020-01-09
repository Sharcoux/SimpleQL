/** Security Plugin. Check the documentation **/
const { security : securityModel } = require('../utils/types');
const check = require('../utils/type-checking');
const log = require('../utils/logger');
const { getOptionalDep } = require('../utils');

const createSecurityPlugin = config => {
  check(securityModel, config);
  const {app, domains, webmaster, requestPerMinute, helmet : helmetConfig } = config;
  const RateLimit = getOptionalDep('express-rate-limit', 'SecurityPlugin');
  const cm = getOptionalDep('compose-middleware', 'SecurityPlugin');
  const helmet = getOptionalDep('helmet', 'SecurityPlugin');
  const greenlock = getOptionalDep('greenlock-express', 'SecurityPlugin');
    
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
  
  app.disable('x-powered-by');

  log('warning', 'NOTICE:\nDo not call app.listen() when using the securityPlugin.\nPorts will be 80 and 443 and this cannot be changed. Run `sudo setcap \'cap_net_bind_service=+ep\' $(which node)` in order to use these ports without root access.');
  greenlock.init(() => {
    const greenlock = require('@root/greenlock').create({
      // name & version for ACME client user agent
      packageAgent: webmaster.split('@')[0],

      // contact for security and critical bug notices
      maintainerEmail: webmaster,

      // where to find .greenlockrc and set default paths
      packageRoot: __dirname,
    });
    greenlock.manager.defaults({
      subscriberEmail: webmaster,
      agreeToTerms: true
    });
    const subjects = domains.filter(domain => domain.split('\\.').length===2);
    const others = domains.filter(domain => domain.split('\\.').length>2);
    subjects.forEach(domain => {
      const subDomains = others.filter(sub => sub.endsWith(domain));
      greenlock.sites.add({
        subject: domain,
        altnames: [domain, ...subDomains]
      });
    });
    return {
      greenlock,
      // whether or not to run at cloudscale
      cluster: false
    };
  }).ready(glx => glx.serveApp(app));
  return {
    middleware: requestPerMinute ? cm.compose([apiLimiter, helmet(helmetConfig)]) : helmet(helmetConfig)
  };
};

module.exports = createSecurityPlugin;