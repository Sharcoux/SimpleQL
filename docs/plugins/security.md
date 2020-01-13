# Security Plugin

We provide a security plugin that will enforce basic security settings for your application, including https support, and headers security.

The security plugin takes in an object parameter containing 4 properties:

 * **app** : The app created with express
 * **domains** : The complete list of domains for which you would like a https support for, including subdomains. Make sure that the DNS points towards your server.
 * **webmaster** : The email address of the webmaster that should be contacted in case of any problem with the certificates or security compromission.
 * **helmet** *(optional)* : helmet parameters. [See the documentation](https://helmetjs.github.io/docs/). Default parameters will be used if it is not provided.

 *Example:*

```javascript
 if(process.env.NODE_ENV==='production') plugins.push(securityPlugin({
  app,
  domains: ['mydomain.com', 'www.mydomain.com'],
  webmaster: 'webmaster@mydomain.com',
}));
```

**IMPORTANT**: You should not call `app.listen()` if you are using the security plugin. The plugin will automatically listen on ports 80 and 443.