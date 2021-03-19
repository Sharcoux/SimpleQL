// @ts-check

/** Security Plugin. Check the documentation **/
const { security: securityModel } = require('../utils/types')
const { check } = require('../utils/type-checking')
const log = require('../utils/logger')
const { getOptionalDep } = require('../utils')
const fs = require('fs')
const path = require('path')

/**
 * @typedef {Object} SecurityPluginConfig
 * @property {string[]} domains The domain this server should be hosted on
 * @property {string} webmaster The email of the person responsible for the domain
 * @property {Object=} helmet The helmet configuration
 */

/**
 * Create the security plugin
 * @param {import('express').Express} app The express app
 * @param {SecurityPluginConfig} config The plugin configuration
 * @returns {import('.').Plugin}
 */
const createSecurityPlugin = (app, config) => {
  check(securityModel, config, 'The Security Plugin Config')
  const { domains, webmaster, helmet: helmetConfig } = config
  const helmet = getOptionalDep('helmet', 'SecurityPlugin')
  const greenlock = getOptionalDep('greenlock-express', 'SecurityPlugin')

  /** Redirects all requests to https */
  function requireHTTPS (req, res, next) { // eslint-disable-line no-unused-vars
    if (!req.secure && process.env.NODE_ENV !== 'development') {
      return res.redirect('https://' + req.get('host') + req.url)
    }
    next()
  }

  log('warning', 'NOTICE:\nDo not call app.listen() when using the securityPlugin.\nPorts will be 80 and 443 and this cannot be changed. Run `sudo setcap \'cap_net_bind_service=+ep\' $(which node)` in order to use these ports without root access.')
  const packageRoot = __dirname
  const configDir = 'greenlock.d'
  fs.mkdirSync(path.normalize(path.join(packageRoot, configDir)), { recursive: true })

  const subjects = domains.filter(domain => domain.split('.').length === 2)
  const others = domains.filter(domain => domain.split('.').length > 2)
  const sites = subjects.map(domain => {
    const subDomains = others.filter(sub => sub.endsWith(domain))
    return {
      subject: domain,
      altnames: [domain, ...subDomains]
    }
  })

  // Read the current config file
  let configRawContent = null
  try {
    configRawContent = fs.readFileSync(path.normalize(path.join(packageRoot, configDir, 'config.json')), 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') { console.error(err.code, err); process.exit() }
  }

  // Update sites with available data if exist
  let configFile = { sites }
  if (configRawContent) {
    configFile = JSON.parse(configRawContent)
    configFile.sites = sites.map(({ subject, altnames }) => {
      const configSiteData = configFile.sites.find(site => site.subject === subject) || {}
      return { ...configSiteData, subject, altnames }
    })
  }

  // Write the updated file content
  const configPath = path.normalize(path.join(packageRoot, configDir, 'config.json'))
  fs.writeFileSync(configPath, JSON.stringify(configFile, null, 4), 'utf8')
  // Fix the file's permissions after greenlock restricted them
  fs.chmodSync(configPath, 0o660)

  // Start greenlock
  greenlock.init({
    packageRoot,
    configDir,
    maintainerEmail: webmaster,
    cluster: false // name & version for ACME client user agent
  }).serve(app)

  return {
    middleware: helmet(helmetConfig)
  }
}

module.exports = createSecurityPlugin
