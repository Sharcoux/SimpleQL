## **WARNING:** This is still in development and not yet ready for production. Use at your own risks!

# SimpleQL
A node framework to manage your backend and your database with the least possible amount of code

## What the heck is SimpleQL and why should I bother?

SimpleQL is a NodeJS framework to create a server in 10 minutes that will handle all kind of data and requests without requiring you to do any low-value logic server-side, nor develop any endpoint. Define a general behaviour that will quickly get you a database working and able to treat all kinds of requests, and then you can add your custom logic where it is needed and valuable.

 * **Simple:** Only one route for all your requests
 * **Predictable:** the response of any SimpleQL request is formatted exactly the same way as the request, so you don't need to wonder about what the result of a request will looks like.
 * **Efficient:** In one single request you can do everything!

### Installation

```
npm install simple-ql -S
```

### API

Check the wiki (links are at the bottom of this page).

### Creating your server

```javascript
const { createServer } = require('simple-ql');
const express = require('express');

//Prepare your tables
const tables = {
    ...
}
//Log into your database solution like mysql
const database = {
    user: ...
    password: ...
    host: ...
    type: 'mysql',
    privateKey: ...
    port: ...
    ...
}
//Create your access table
const access = {
    ...
}
//Create your plugins
const plugins = [
    loginPlugin({...}),
    customPlugin(),
    ...
]

const app = express();
app.listen(80);
const root = '/';//This is the path the SimpleQL requests should be addressed to. It will default to '/'.
createServer({app, tables, database, rules, plugins, root});
```

**Note:** You can also add options like the `root` path of the api, the `sizeLimit` of acceptable requests, or the number of `requestPerMinute` the api should handle, as parameter of the `createServer` function:

```javascript
createServer({app, tables, database, rules, plugins}, {sizeLimit: '50mb', requestPerMinute: 100, root: '/'});
```

Read more about the [optionnal parameter](docs/options.md).


### Examples
 * You can find [here](example.js) a full example of a messenger-like SimpleQL server configuration
 * You can find [here](https://gitlab.com/Sharcoux/file-storage) a complete backend to host user files and manage data limitation.

This is what a SimpleQL request will look like:

```javascript
    {
      Comment : {
        author: {
          email : 'user2@email.com',
        },
        date : {
          '<=' : new Date(new Date(date).setHours(date.getHours() + 2)).toISOString(),
          '>=' : new Date(new Date(date).setHours(date.getHours() - 2)).toISOString(),
        },
        set : {
          title : 'random',
        }
      }
    }
```

**Example:** [You can find here a set of requests matching the previous server example](https://github.com/Sharcoux/SimpleQL/blob/master/test.js)

In one request, we are getting all the messages from `user2@email.com` published 2h around `date`, and we are changing their title to `random`. This is what the response will looks like:

```javascript
 {
  Comment: [
    {
      title: 'random',
      date: '2019-05-05T05:10:32.000Z',
      author: { email: 'user2@email.com' },
      lastModification: '2019-05-05T06:01:33.005Z',
      edited: true,
    }
  ]
}
```

## To go deeper

### [Prepare your tables](docs/tables.md)
### [Setup access to your database (like MYSQL)](docs/database.md)
### [Setting access rights](docs/access.md)
### [Adding plugins](docs/plugins.md)
### [Requesting your database](docs/requests.md)
### [Server options](docs/options.md)
### [Testing](https://github.com/Sharcoux/simple-ql-testing)
