# Server options

## The optionnal `option` parameter

Beside the main object property, you can provide the following options:

 * **root** : The path to the api. Defaults to '/'.
 * **requestPerMinute** : The maximum amount of request that the server should handle per minute. Default is 1000. `0` or `false` to deactivate.
 * **sizeLimit** : The maximum size of request that the server should handle, as a human readable string. Default is `5mb`. `0` or `false` to deactivate.

```javascript
createServer({app, tables, database, rules, plugins}, { root: '/api', sizeLimit: '50mb', requestPerMinute: 0 });
```
