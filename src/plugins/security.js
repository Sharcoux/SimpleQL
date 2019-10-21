const { security : securityModel } = require('../utils/types');
const check = require('../utils/type-checking');
const log = require('../utils/logger');

function missing(dep) {
    throw new Error(`You should add ${dep} to your dependencies to use the SecurityPlugin. Run\nnpm i -D ${dep}`);
}

const createSecurityPlugin = ({app, domains, emailACME }) => {
    check(securityModel, {app, domains, emailACME});
    
    const RateLimit = require('express-rate-limit');
    const cm = require('compose-middleware');
    const helmet = require('helmet');
    const greenlock = require("greenlock-express");
    const greenlockStore = require("greenlock-store-fs");
    if(!RateLimit) missing('express-rate-limit');
    if(!cm) missing('compose-middleware');
    if(!helmet) missing('helmet');
    if(!greenlock) missing('greenlock-express');
    if(!greenlockStore) missing('greenlock-store-fs');
    
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
  
    log('warning', 'NOTICE:\nDo not call app.listen() when using the securityPlugin.\nPorts will be 80 and 443 and this cannot be changed. Run `sudo setcap \'cap_net_bind_service=+ep\' $(which node)` in order to use these ports with non without root access.');
    greenlock
        .create({
            email: emailACME, // The email address of the ACME user / hosting provider
            agreeTos: true, // You must accept the ToS as the host which handles the certs
            configDir: "~/.config/acme/", // Writable directory where certs will be saved
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
        middleware: cm.compose([apiLimiter, helmet()])
    }
}

module.exports = createSecurityPlugin;