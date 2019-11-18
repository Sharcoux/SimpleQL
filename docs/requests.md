# Requesting your database

SimpleQL server will listen to any request made to the server on the root path defined when creating the server (`/` by default). You can use Ajax, axios or request-promise from the client. You can use all methods but `post` is probably the best suited. For server-side requests, see the [database documentation](./database.md).

## Simple requests

You can now get information from the database by sending this kind of request body:

```javascript
{
  User : {
    name : 'John Doe',
    get: ['contacts'],
  }
}
```

This will give you all the contacts of the user named 'John Doe'. But only the fields containing primitive values are retrieved. If you want to go deeper, do this :

```javascript
{
  User : {
    name : 'John Doe',
    contacts : {
      get: ['name', 'mentor', 'contacts']
    }
  }
}
```

This will retrieve also the primitive values form the *mentor* and the *contacts*. You could also use this syntax to get all the values associated with each contacts:


```javascript
{
  User : {
   name : 'John Doe',
   contacts : {
       get: '*',
   }
}
```

As you can see, **get** is a keyword that can be use to list the data you want to retrieve from a table. It can be a list of column names, or the string `'*'` meaning that you want to get all the first level informations that you can get.

More generally, each request must be an object containing as keys the names of the tables you are trying to retrieve data from. The value associated with each key must be an object where each key is a column of the table. The value must be:
- A single value *(like 'John Doe', or 18, or true)*
- An array of values *(like [18, 28])*
- An object containing keywords *(see **More complex researches** below)*
- An object containing constraints if the column is a reference to another table
- An array of such objects.

For instance, the following request will get you the details about all users for which **John Doe** is a mentor:

```javascript
{
  User : {
    mentor : {
        name : 'John Doe',
    }
    get: '*',
}
```

## Required keyword

When want to request a table that contains a column defined as an array of an other table (association tables), for instance: `contacts: [User]`, you need to precise if you want the constraints on this column to be mandatory or not.

The following request will get you all the Users named 'John Doe', and for each of them, the list of their contacts.

```javascript
{
  User : {
    name : 'John Doe',
    contacts: {
        get: '*',
    }
}
```

On the other hand, the following request will get you only the Users named 'John Doe' and who do have contacts

```javascript
{
  User : {
    name : 'John Doe',
    contacts: {
        required: true,
        get: '*',
    }
}
```

This last request will get you all the users named 'John Doe', but for each one of them, `contacts` will be the list of their contacts that are eighteen years old.

```javascript
{
  User : {
    name : 'John Doe',
    contacts: {
        age: 18,
    }
}
```

If you wanted only the users that do have contacts of eighteen years old, you need to add `required: true` to the request.

## More complex researches

You can use `not`, `like`, `gt`, `ge`, `lt`, `le`, `<`, `>`, `<=`, `>=`, `~`, `!` properties to make more complex researches in the database *(`gt`, `ge`, `lt` and `le` respectively stand for `greater than`, `greater or equal`, `less than` and `less or equal`. `~` stands for `like` and `!` stands for `not`)*.

```javascript
{
  User : {
    age,
    name : {
      like : 'John%',
    }
  }
}
```

This might give you this:

```javascript
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

```javascript
{
  User : {
    name : {
      like : 'John',
      not : '%Doe',
    },
    age : {
      not : 18,
    }
  }
}
```

You can also use `order`, `limit` and `offset` to control the results.

```javascript
{
  User : {
    name : 'John Doe',
    contacts : {
      limit: 10,
      offset: 10,
      order: ['name', '-age'],
      get: ['name'],
    }
  }
}
```

* **limit**: Limit the number of results to the amount specified as an integer
* **offset**: Excludes the first results of the research, specified as an integer
* **order**: The list of column to be sorted by priority order. To sort by reversed order, preceed the column name with minus sign `-`

## Updating the database

### Updating data

To update data, you just need to use the `set` property:

```javascript
{
  User : {
    name : {
      like : 'John%',
    }
    set : {
      age : 20,
    }
  }
}
```

The following request will make 'Jane Doe' the mentor of 'John Doe', assuming there is only one user named 'Jane Doe'.

```javascript
{
  User : {
    name : 'John Doe',
    set : {
      mentor : {
          name: 'Jane Doe',
      }
    }
  }
}
```

Finally, this request will remove all the previous contacts of 'John Doe' and replace it with the list of the users named 'Jane Doe'.

```javascript
{
  User : {
    name : 'John Doe',
    set : {
      contacts : {
          name: 'Jane Doe',
      }
    }
  }
}
```

If you want to only add a contact, see **Linking entities** below.


### Inserting data

To create a new object into a table, use the `create` keyword.

```javascript
{
  User : {
    name : 'John Doe',
    age : 18,
    create : true,
  }
}
```

### Linking entities

To link entities between tables, use the `add` property.

This will try to add to John Doe all contacts responding to one of the constraint objects.

```javascript
{
  User : {
    name : 'John Doe',
    contacts : {
      add : [
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

### Unlinking entities

To unlink entities, use the `remove` property.

This will remove 2 contacts from John Doe's contacts:

```javascript
{
  User : {
    name : 'John Doe',
    contacts : {
      remove : [
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

### Deleting elements

To remove an object from a table, use the `delete` keyword.

```javascript
{
  User : {
    name : 'John Doe',
    age : 18,
    delete : true,
  }
}
```

## Warning : Delete cascade

Deleting an element from a table like `User` will remove it from all the array properties it appears in, like `contacts`. If it appeared in a property like `mentor` the object will too be deleted in cascade. To prevent this, you should unlink any object referencing the deleted element by setting its value to `null` for instance.

For instance, before removing John Doe, you should execute:

```javascript
{
  User : {
    mentor : {
      name : 'John Doe'
    }
    set : {
      mentor : null
    }
  }
}
```

This could be made in a [custom plugin](Adding-plugins)

## Combine instructions

You can combine all kind of instructions in one single request:

```javascript
{
  User : [{
   name : 'John Doe',
   contacts : {
     add: [
       {
          name : 'Jane Doe',
          create : true,
          contacts : {
            name : 'John Doe',
          }
       },
       {
          name : 'Ben Kenobi',
          create : true,
          contacts : {
            name : 'John Doe',
          }
       },
  ]
}
```

This will create the users **Ben Kenobi** and **Jane Doe** and add them both to **John Doe**'s contacts. While doing so, it will add **John Doe** to their own contacts.