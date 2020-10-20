# Login Plugin

We provide a plugin to handle login to the server through a JWT token, a couple email/password, or using Facebook/Google Authentication. The passwords are hashed and *(optionnaly)* salted.

The login plugin takes an object parameter containing 5 properties:

 * **userTable** : The name of the table beeing used to store the users
 * **login** : The column being used to store the logins
 * **password** : The column being used to store the passwords
 * **salt** *(optional)* : The column being used to store the salts encrypting the password
 * **plugins** *(optionnal)* : An object describing optionnal behaviours that you may or may not activate for loggin. This object supports the following plugins:
    * **google** : the name of the property to look for the google access token.
    * **facebook** : the name of the property to look for the facebook access token.

## Usage example

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

### Sign in

Sign in is done like this:

```javascript
const request = {
  User : {
    email : 'myLogin',
    password : 'myPassword',
    ...
    //Other user data if any
    ...
    create: true,
  }
}
```

**Note:** The password will be hashed (and salted if the column was provided) before being set into the database.

### Login / Password authentication

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

### Google and Facebook authentication

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

## jwt configuration

To specify jwt config, just pass the following optionnal parameter:

 * **algorithm** : The algorithme to be used (default: HS256). Find the list [here](https://github.com/auth0/node-jsonwebtoken#algorithms-supported)
 * **expiresIn** : Expressed in seconds or a string describing a time span zeit/ms. Eg: 60, "2 days", "10h", "7d". A numeric value is interpreted as a seconds count. A string value without units will be interpreted as milliseconds.
 * **notBefore** : Expressed in seconds or a string describing a time span zeit/ms. Eg: 60, "2 days", "10h", "7d". A numeric value is interpreted as a seconds count. A string value without units will be interpreted as milliseconds.

Here are the other parameters:

 * audience
 * issuer
 * jwtid
 * subject
 * noTimestamp
 * header
 * keyid
 * mutatePayload

See the details at [jsonwebtoken website](https://github.com/auth0/node-jsonwebtoken)

Generated jwts will include an iat (issued at) claim by default unless noTimestamp is specified. If iat is inserted in the payload, it will be used instead of the real timestamp for calculating other things like exp given a timespan in options.expiresIn.
