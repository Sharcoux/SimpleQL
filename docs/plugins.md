# Adding plugins

To handle server-side logic and custom behaviours, you can add plugins that we provide, or create your own if you like.

## Provided plugins

Only one plugin is currently available. More are coming!

### Login

We provide a plugin to handle login to the server through a JWT token or a couple email/password. The passwords are hashed and *(optionnaly)* salted.

The login plugin takes an object parameter containing 5 properties:

 * **userTable** : The name of the table beeing used to store the users
 * **login** : The column being used to store the logins
 * **password** : The column being used to store the passwords
 * **salt** *(optional)* : The column being used to store the salts encrypting the password
 * **plugins** *(optionnal)* : An object describing optionnal behaviours that you may or may not activate for loggin. This object supports the following plugins:
    * **google** : the name of the property to look for the google access token.
    * **facebook** : the name of the property to look for the facebook access token.

**Example**

```javascript
const { login : { loginPlugin } } = require('simple-ql');
const plugins = [
  loginPlugin({
    login: 'email',
    password: 'password',
    salt: 'salt',
    userTable: 'User',
  }),
];
```

To log into a table, just send the following request:

```javascript
const request = {
  User : {
    email : 'myLogin',
    password : 'myPassword',
  }
}
```

You will receive a SimpleQL response of this type

```javascript
{
  User : {
    email : 'myLogin',
    jwt : 'jwt token',
  }
}
```

#### Google and Facebook authentication

This is how you can enable Google and Facebook authentication:

```javascript
  loginPlugin({
    login: 'email',
    password: 'password',
    salt: 'salt',
    userTable: 'User',
    plugins: {
        google: 'googleToken',//This will enable Google authentication when googleToken property is provided in requests
        facebook: 'facebookToken'//This will enable Facebook authentication when facebookToken property is preovided in requests
    }
  }),
```

This is how you can log in a user with Facebook:

```javascript
{
  User : {
    login : '<facebook userId>',
    facebookToken : '<facebook access token>',
  }
}
```

This is how you can sign in a user with Google:

```javascript
{
  User : {
    googleToken : '<google access token>',
    create: true,
  }
}
```

**Note**: Don't forget to register your domain on Facebook and Google to enable this kind of access.


### Security

We provide a security plugin that will enforce basic security settings for your application, including https support, headers security and requests rate limite.

The login plugin takes an object parameter containing 4 properties:

 * **app** : The app created with express
 * **domains** : The list of domains for which you would like a https support. Make sure that the DNS points towards you server.
 * **emailACME** : The email address of the ACME user / hosting provider
 * **requestPerMinute** *(optional)* : The maximum amount of request that the server should handle.
 * **helmet** *(optional)* : helmet parameters. [See the documentation](https://helmetjs.github.io/docs/). Default parameters will be used if it is not provided.

 *Example:*

```javascript
 if(process.env.NODE_ENV==='production') plugins.push(securityPlugin({
  app,
  domains: ['mydomain.com', 'www.mydomain.com'],
  emailACME: 'webmaster@mydomain.com',
}));
```

## Express middleware and error handler

As a matter of facts, you can also provide [express middleware](https://expressjs.com/en/guide/using-middleware.html) and an [error handler](https://expressjs.com/en/guide/error-handling.html) directly when creating the server. They will be merged with the plugins middlewares.

```javascript
const app = express();
const middleware = (req, res, next) => next();
const middlewares = [middleware];
const errorHandler = (err, req, res, next) => next(err);
createServer({app, tables, database, rules, plugins, middlewares, errorHandler});
```

## Create your own plugin

['middleware', 'onRequest', 'onCreation', 'onDeletion', 'onResult', 'preRequisite', 'errorHandler'];
A plugin consist in an object containing the following optional properties:

 * **preRequisite** : A function that will make sure that the plugin is correctly configured.
 * **middleware** : A middleware that might intercept the whole request.
 * **onRequest** : An object containing functions being called before any request in a specific table.
 * **onCreation** : An object containing functions being called each time an element is created into a specific table.
 * **onDeletion** : An object containing functions being called each time an element is deleted from a specific table.
 * **onResult** : An object containing functions being called after a request was resolved in a specific table.
 * **onError** : An object containing functions being called when a request failed to resolve in a specific table.
 * **errorHandler** : A middleware able to handle errors generated by this plugin before being sent to the user.

### Prerequisite

This should be a function taking the tables as a parameter. It should then return a Promise that would reject if the plugin configuration is wrong given the provided tables. For instance, if the `userTable` that have been provided upon creation is actually not present in the `tables` object.

```function preRequisite(tables) { return Promise.resolve(); }```

### middleware

This is exactly an [express middleware](https://expressjs.com/en/guide/using-middleware.html).

```function middleware(req, res, next) { return Promise.reject().catch(next).then(() => next()); }```

### onRequest

This is an object describing all the functions that should be called when a request starts on any table. It will receive the [onEvent parameters](#onevent-parameters) as second parameter.

```javascript
const onRequest = {
    User : (request, {request, parent, query, local, isAdmin}) => Promise.resolve()
}
```

### onCreation

This is an object describing all the functions that should be called when an object is created inside any table. It will receive the [onEvent parameters](#onevent-parameters) as second parameter.

```javascript
const onCreation = {
    User : (createdObject, {request, parent, query, local, isAdmin}) => Promise.resolve()
}
```

### onDeletion

This is an object describing all the functions that should be called when an object is deleted from any table. It will receive the [onEvent parameters](#onevent-parameters) as second parameter.

```javascript
const onDeletion = {
    User : (deletedObjectsArray, {request, parent, query, local, isAdmin}) => Promise.resolve()
}
```

### onResult

This is an object describing all the functions that should be called when a request has been fully executed in any table. It will receive the [onEvent parameters](#onevent-parameters) as second parameter.

```javascript
const onResult = {
    User : (results, {request, parent, query, local, isAdmin}) => Promise.resolve()
}
```

### onSuccess

This callback is called when the whole request will succeed and the changes will be committed to the database. It will receive the [onEvent parameters](#onevent-parameters) as second parameter. It is probably not recommanded to throw an error at this point.

```javascript
const onSuccess = {
    User : (request, results) => Promise.resolve()
}
```

### onError

This callback is called when the whole request will fail and the changes made to the database will be rolled back. It will receive the [onEvent parameters](#onevent-parameters) as second parameter.

```javascript
const onError = {
    User : (error, {request, parent, query, local, isAdmin}) => Promise.resolve()
}
```

### errorHandler

This is an [express errorHandler](https://expressjs.com/en/guide/error-handling.html).

```function middleware(err, req, res, next) { return next(err); }```


## onEvent parameter

The onEvent parameter consist of an object containing the following properties

 * **request** : The request currently being executed.
 * **parent** : The parent of the request currently being executed.
 * **isAdmin** : A boolean indicating if the current request is being executed as an administrator.
 * **query** : A function that you can use to make a SimpleQL query to the database.
 * **local** : The current request local variables (like authId). You can read them or edit them directly through this object.

### parent

This is the parent of the current request part.

Consider the following request:

```javascript
    {
      Feed : {
        participants : [
          { email : 'user1@email.com' },
          { email : 'user2@email.com' },
        ],
        comments : {
          add : {
            create : true,
            content : 'test',
            title : 'Test',
            author: {
              email : 'user2@email.com',
            }
          }
        }
      }
    }
```

This request will create a comment inside the `Comment` table, and add this comment to the Feed table. The `parent` of the `Comment` request is the `Feed` request. This will be the value of `parent`:

```javascript
      {
        participants : [
          { email : 'user1@email.com' },
          { email : 'user2@email.com' },
        ],
        comments : {
          add : {
            create : true,
            content : 'test',
            title : 'Test',
            author: {
              email : 'user2@email.com',
            }
          }
        }
      }
```

### isAdmin

This is a boolean indicating if the current request is being executed with admin rights. You can use this to avoid looping into your event handler. Especially for `onRequest` and `onResult`

### query

The query function provided can be used to make SimpleQL requests to the database. This function takes 2 parameters: the SimpleQL request, and an optional object having the following properties:

 * **admin** *(boolean : default false)* : indicate that the request should be made with admin credentials. Be careful, this will ignore all access rules.
 * **readOnly** *(boolean : default false)* : indicate that the request should only read data and is not allowed to make any change to the database.

### local

This objects provide the local variables used through the request. You can read the values or edit them by updating the object. Right now, the only parameter that you can change is the `authId`.

For instance:

    local.authId = privateKey; //This will make the request executed with admin rights from now on.

This would make the complete request being executed as `admin`. (this should be avoided at all cost!)




