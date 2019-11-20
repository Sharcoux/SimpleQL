# Access to database

## Setup the access to your database

You need to provide the database information needed to establish a connexion to your database. This is what it should look like:

```javascript
    const database = {
      user: 'root',             // the login to access your database
      password: 'password',     // the password to access your database
      type: 'mysql',            // the database type that you wish to be using
      privateKey: 'key',        // a private key that will be used to identify requests that can ignore access rules
      host : 'localhost',       // the database server host
      database: 'myDatabase',   // the name of your database
      create : true,            // we require to overwrite any pre-existing database with the same name
};
```

### types

Currently, only **mysql** is available.

### privateKey

This should be consider as an administrator password. Requests using thins key will be granted all access and access control rules will be ignored (see setting access rights).

### create

Right now, when you want to create the database the first time, you need to set `create` to `true`. Once your database is created, you will need to remove the `create` option. This will be improved in the future.

### Others

You can set various options. For **mysql**, you can find the list [here](https://github.com/mysqljs/mysql#connection-options)

## Make server-side requests to the database

You can use SimpleQL server-side to query the database. To do so, you will need to require the asynchronous function getQuery from simple-ql package:

```javascript
const { getQuery } = require('simple-ql');

getQuery('myDatabase')
  //Make the server-side request
  .then(query => query({
    User: {
      email : 'user1@email.com',
      contacts : {
        add : {email: 'user2@email.com'},
      }
    }
  }))
  //Log the results
  .then(results => console.log(results));
```

`query` is a function that will take 2 parameters:

* **request**: the SimpleQL request that you wish to execute on the database
* **userId**: the *reservedId* of the user that you want the request to be executed on the behalf of. By default, the request will be executed with admin rights and full access to the database will be granted, ignoring the [rules](./access.md) defined for this database. If you want the request to be limited to the access rights a specific user would be granted, just use its *reservedId* as second parameter for the request.

*Example:*

```javascript
getQuery('myDatabase')
  //Make the server-side request
  .then(query => query({
    User: {
      email : 'user2@email.com',
      get: '*',
    }
  }, 1))
  //Log the results
  .then(results => console.log(results));
```

This request will be executed on the behalf of the user whose *reservedId* is 1. Thus, this request will not retrieve the password of the user as this information is not readable.