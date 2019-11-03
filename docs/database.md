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
      database: 'simpleql',     // the name of your database
      create : true,            // we require to overwrite any pre-existing database with the same name
};
```

## types

Currently, only **mysql** is available.

## privateKey

This should be consider as an administrator password. Requests using thins key will be granted all access and access control rules will be ignored (see setting access rights).

## create

Right now, when you want to create the database the first time, you need to set `create` to `true`. Once your database is created, you will need to remove the `create` option. This will be improved in the future.

## Others

You can set various options. For **mysql**, you can find the list [here](https://github.com/mysqljs/mysql#connection-options)


