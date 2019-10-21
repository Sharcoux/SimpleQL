## **WARNING :** This is still in development and not yet ready for production. Use at your own risks!

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
    login: ...
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
createServer({app, tables, database, rules, plugins});
```

**Note:** You can also add a list of *express* **middlewares** and an **error handler** directly as parameter of the `createServer` function:

```javascript
const middleware = (req, res, next) => next();
const middlewares = [middleware];
const errorHandler = (err, req, res, next) => next(err);
createServer({app, tables, database, rules, plugins, middlewares, errorHandler});
```

**Example:** [You can find here a full example of a messenger-like SimpleQL server configuration](https://github.com/Sharcoux/SimpleQL/blob/master/example.js)

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

### [Prepare your tables](https://github.com/Sharcoux/SimpleQL/wiki/tables-configuration)
### [Setup access to your database (like MYSQL)](https://github.com/Sharcoux/SimpleQL/wiki/access-to-database)
### [Setting access rights](https://github.com/Sharcoux/SimpleQL/wiki/setting-access-rights)
### [Adding plugins](https://github.com/Sharcoux/SimpleQL/wiki/adding-plugins)
### [Requesting your database](https://github.com/Sharcoux/SimpleQL/wiki/simpleql-requests)
