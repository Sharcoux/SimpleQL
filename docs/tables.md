# Tables configuration

## Creating the tables

This is what a table should look like during table creation:

```javascript
    const User = {
      name : 'string/20',
      age : 'integer',
      mentor : User,
      contacts : [User],
    }
```

Each column of your table will be represented as a property of an object representing the table.

The properties value can be:
* **a string** denoting the data type of your table, and an optional size parameter. Otherwise, the default size will be used ([see data types](#data-types))
* **an object** that will describe the data type with more details ([see data types](#data-types))
* **one of the tables** that you already have defined ([see self-references / cross-references](#self-references--cross-references-between-tables))
* **an array containing one of the tables** that you have previously defined ([see self-references / cross-references](#self-references--cross-references-between-tables))

## Data types

Inside your table object, to each column name, you must associate a data type. Current valid data types are the following:

 * string
 * integer
 * float
 * double
 * decimal
 * date
 * dateTime
 * time
 * year
 * boolean
 * char
 * text
 * binary
 * varbinary
 * varchar *(synonymous: **string**)*
 * json

  const acceptedTypes = ['string', 'integer', 'float', 'double', 'decimal', 'date', 'dateTime', 'time', 'year', 'boolean', 'char', 'text', 'binary', 'varbinary', 'varchar', 'json', ];


There are 2 ways to express a data type:

### The short string form

You can provide a string containing the **data type** optionally followed by the **size** of the column in *bytes*. **/** is used to separate 2 arguments.

**Example:**

```javascript
    const User = {
      pseudo: 'string/25',
      email: 'string/40',
      password: 'binary/64',
      salt: 'binary/16',
    }
```

### The object form

If you need to provide more details, you can use an object to describe your data type. In this case, you can provide the following parameters:

 * **data type** (one of: string, integer, float, double, decimal, date, dateTime, boolean, text, binary)
 * **length** (in byte)
 * **unsigned** (boolean : default false)
 * **notNull** (boolean : default false)
 * **defaultValue**
 * **autoIncrement** (boolean : default false)

**Example:**

```javascript
    const Comment = {
      content: 'text',
      title: {
        type : 'string',
        length: 60,
        notNull : true,
        defaultValue : null,
      },
    }
```

## Indexes

To create an index to your table, simply add an `index` entry to your object. The value should ba an array containing the indexes.

There are 2 ways to describe an index:

### The short string form

You can provide a string containing the **column name** of the index, optionally followed by the **type** of index and/or the **size** of the index of the index in *bytes*. **/** is used to separate 2 arguments.

Valid types are:

 * **fulltext**
 * **unique**
 * **spatial**

**Example:**

```javascript
    const User = {
      pseudo: 'string/40',
      description: 'text',
      creation: 'date',
      index : ['creation', 'description/fulltext', 'pseudo/unique/8'],
    }
```

### The object form

If you need to provide more details, you can use an object to describe your data type. In this cas, you can provide the following parameters:

 * **column**
 * **type** (one of: unique, fulltext, spatial, undefined. Default: undefined)
 * **length** (in byte)

You can generate an index over multiple columns. In this case, you must use the object form and provide a table for `column` and optionally for `length`.

**Example:**

```javascript
    const User = {
      firstname: 'string/40',
      lastname: 'string/40',
      index: [
        {
          column: 'email',
          type: 'unique',
          length: 8,
        },
        {
          column: ['firstname', 'lastname'],
          type: 'unique',
          length: [10,10],
        },
      ]
    }
```

## Self-references / Cross references between tables

If you get the following message:

`<your column>[] has undefined value in <your table>. It should be a string, an array or an object. If you tried to make a self reference or a cross reference between tables, see the documentation.`

This means that you tried to create a reference between tables at a moment when the target table was not yet defined. There are 2 ways to fix this:

### 1) Linking the tables after creating them with their own properties

```javascript
    const User = {
      name : 'string/20',
      age : 'integer',
    }
    User.mentor = User;
    User.contacts = [User];
```

This might make it harder to read the interactions between tables and the complete list of a table's properties. I encourage you using the option below.

### 2) Creating all the tables and then creating all the properties and links at once with Object.assign

```javascript
    const User = {};
    Object.assign(User, {
        name : 'string/20',
        age : 'integer',
        mentor : User;
        contacts : [User];
    });
```
