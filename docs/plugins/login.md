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

## Sign in

Sign in is done like this:

## Login

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