## **WARNING :** This is still in development and not yet ready for production. Use at your own risks!

# SimpleQL
A node framework to manage your backend and your database with the least possible amount of code

## What the heck is SimpleQL and why should I bother?

SimpleQL is a NodeJS framework to create a server in 10 minutes that will handle al kind of data and requests without requiring you to do any logic server-side, nor develop any endpoint.

 * **Simple:** Only one route for all your requests
 * **Predictable:** the response of any SimpleQL request is formatted exactly the same way as the request, so you don't need to wonder about what the result of a request will looks like.
 * **Efficient:** In one single request you can do everything!

### Installation

```
npm install simple-ql -S
```

### Creating your server

```javascript
const { createServer } = require('simple-ql');

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

createServer({port : 80, tables, database, rules, plugins})
```

### [Prepare your tables](tables-configuration)
### [Setup access to your database (like MYSQL)](access-to-database)
### [Setting access rights](setting-access-rights)
### [Adding plugins](adding-plugins)
### [Requesting your database](simpleql-requests)

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

