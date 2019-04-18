# SimpleQL
A node framework to manage your backend and your database with the least possible amount of code

//Notes
- Request:
offset, limit, get, set, create, delete, add, remove
- constraints:
<, >, <=, >=, !, gt, lt, ge, le, not, ~, like
- db:
type, length, nullable, unsigned, defaultValue, autoIncrement,
- createServer
createServer({port = 443, login = {login: 'email', password: 'password', salt: null, userTable: 'User'}, tables, database, rules, preprocessing, middlewares = [] }
types:
'string', 'integer', 'float', 'double', 'decimal', 'date', 'dateTime', 'boolean', 'text', 'binary'
index:
pas de tableaux dans la forme string
plugin:
['middleware', 'onRequest', 'onCreation', 'onDeletion', 'onResult', 'preRequisite', 'errorHandler'];
## Getting Started

## Installation

```
npm install simple-ql -S
```

## Prepare your tables

### Creating the tables

```
const User = {
  name : 'string/20',
  age : 'integer',
  mentor : User,
  contacts : [User],
}
```

Each column of your table will be represented as a property of an object representing the table.

The properties value can be:
* a string denoting the data type of your table, and an optional size parameter. Otherwise, the default size will be used.
* one of the tables that you already have defined
* an array containing one of the tables that you have previously defined

The following example is now valid:

```
const Stuff = {
  name : 'string/20',
  count : 'integer',
  owner : User,
  done : 'boolean',
}
```

**Every table will also be added a unique, auto-incremented `reservedId` property**

### Data types

Possible data types are:

* boolean
* integer
* double
* float
* date
* dateTime
* string
* text


### Creating indexes

When creating a table, you can create indexes with the `index` property, this way:

```
const User = {
  name : 'string/20',
  age : 'integer',
  mentor : User,
  contacts : [User],
  index : {
    name : 'unique',
    age,
  }
}
```

## Access to your database solution (like MYSQL)

Just create an object with the following properties:

```
const database = {
    login: 'root',
    password: 'password',
    host : 'localhost',
    type: 'mysql',
    privateKey: 'key',
    port: 3306,
};
```

*For now, `type` can only be 'mysql'. We will provide drivers for other database soon.`

## Setting access rights

For each element you want to manage access, you need to provide a function `read` and a function `write` that will manage respectively the rights to access or to modify that element. We provide 3 basic management high order functions: `is`, `member`, and `none`. If nothing is provided, the data is reputed public. The default behaviour can be changed.

### is

The `is` function will grant access to people whose `id` is the same as the property passed to the function. The `id` is decoded from the JWT token received with the request.

```
import { is } from 'simple-ql';
{
  Stuff: {
    count : {
      write : is('owner'),
    },
  },
}
```

### memeber

The `is` function will grant access to people whose `id` denote an entity that belongs to an array property passed to the function. The `id` is decoded from the JWT token received with the request.

You can use an array of functions. The access will be granted if any of them would grant access.

You can use `.` to navigate through objects until the desired property.

In the example below, `count` can be edited by the `owner` of the `Stuff`, but it can also be accessed by any of the `contacts` of the `owner`.

```
import { member } from 'simple-ql';
{
  User : {
    age : {
      read : member('contacts'),
    },
  },
  Stuff : {
    count : {
      read : [is('owner'), member('owner.contacts'),
      write : is('owner'),
    }
  }
}

```

### none

The `none` object will grant access to no one. The only way to access or edit the data would be to use the `privateKey` of the server.

All tables will automatically include an `reservedId` property with `read` and `write` access set to `none`.

```
{
  User : {
    name : {
      write : none,
    },
  },
}
```

## Create your tables

```
import createDatabase from 'simple-ql'

//Prepare your tables
...
//Log into your database solution like mysql
...
//Create your access tables
...

createDatabase(tables, database, access);
```

## Requesting your database

### Simple request

You can now get information from the database by sending this request body:

```
{
  User : {
    name : 'John Doe',
    contacts : undefined,
  }
}
```

This will give you all the contacts of the user named 'John Doe':

```
{
  User : 'John Doe',
  contacts : [
    {
      name : 'Jane Doe',
    },
    {
      name : 'Ben Kenobi',
    },
  ]
}
```

Only the fields containing primitive values are retrieved. If you want to go deeper, do this :

```
{
  User : {
    name : 'John Doe',
    contacts : {
      name : undefined,
      mentor : undefined,
      contacts : undefined,
    }
  }
}
```

### More complex research

You can use `like`, `not`, `gt`, `ge`, `lt`, `le`, `limit` and `offset` properties to make more complex researches in the database:

```
{
  User : {
    age,
    like : {
      name : 'John%',
    }
  }
}
```

This might give you this:

```
[
  {
    name : 'John Doe',
    age : 18,
  },
  {
    name : 'John Snow',
    age : 28,
  },
]
```

You can mix them, and `not` can be combined with any of them:

```
{
  User : {
    like : {
      name : 'John',
    },
    not : {
      age : 18,
      like : {
        name : '%Doe',
      }
    }
  }
}
```

*`gt`, `ge`, `lt` and `le` respectively stand for `greater than`, `greater or equal`, `less than` and `less or equal`*

## Updating the database

### Updating data

To update data, you just need to use the `set` property:

```
{
  User : {
    like : {
      name : 'John%',
    }
    set : {
      age : 20,
    }
  }
}
```

### Inserting data

To insert data, use the `insert` property.

This will add 2 new contacts. If they do not exist, they will be added to the `User` table. Existence will be detected by equality of every field provided. If the details provided are not enough to ensure unicity, the request will fail. That's why we advise using at least one unique index key if possible.

```
{
  User : {
    name : 'John Doe',
    contacts : {
      insert : [
        {
          name : 'Jane Doe',
          age : 17,
        },
        {
          name : 'Mummy',
          age : 48,
        },
      ]
    }
  }
}
```

### Deleting data

To insert data, use the `delete` property.

This will remove 2 contacts from John Doe's contacts:

```
{
  User : {
    name : 'John Doe',
    contacts : {
      delete : [
        {
          name : 'Jane Doe',
        },
        {
          name : 'Mummy',
        },
      ]
    }
  }
}
```

Deleting an element from a table like `User` will remove it from all the array properties it appears in, like `contacts`. If it appeared in a property like `mentor`, it's value will become `null`.

## Controlling requests

In addition with the `read` and `write` access control, you can create rules that will behave like middlewares towards the incoming request, or create parallel requests passing the privateKey as jwt.