# Setting access rights

For each element you want to manage access, you need to provide a function `read` and a function `write` that will manage respectively the rights to access or to modify that element. We provide 3 basic management high order functions: `is`, `member`, and `none`. If nothing is provided, the data is reputed public.

Moreover, the following rules can be provided:

### For each table:

 * **read** : Who can read the data of this table. This rule can be overwritten by column rules.
 * **write** : Who can edit the data of this table. This rule can be overwritten by column rules.
 * **create** : Who can create elements inside of this table.
 * **delete** : Who can delete elements from this table.

### For each column:

 * **read** : Who can read the content of this column. This rule overwrite the table rule.
 * **write** : Who can edit the data of this table. This rule overwrite the table rule.

### For columns denoting an array:

 * **read** : Who can read the data of this table. This rule overwrite the table rule.
 * **write** : Who can edit the data of this table. This rule overwrite the table rule.
 * **add** : Who can add elements inside of this column.
 * **remove** : Who can remove elements from this column.

## Rules

### all

The `all` rule will grant access to no anyone. This is the default behaviour.

### none

The `none` rule will grant access to no one. The only way to access or edit the data would be to use the `privateKey` of the server (see setup access to database).

All tables will automatically include a `reservedId` property with `write` access set to `none`.

See below for an example.

### is(field)

The `is` function will grant access to people whose `id` is the same as the `field` property passed to the function. The `id` is decoded from the JWT token received with the request. A special value `self` is available and means that we expect the user authenticated to be the same as the object we are trying to access to.

**Example**

```javascript
const { is, none } = require('simple-ql');
const rules = {
  User: {
    pseudo : {
      write : is('self'), //Only the user can change their own name
    },
  },
  Comment: {
    write : is('author'), //Only the author of the message can edit it
    author : {
      write : none,       //Despite the previous rule, no one can edit the author of a message
    }
  }
}
```

### or(...rules)

You can pass a list of rules to the `or` rule. The access will be granted if any of them would grant access.

See below for an example.

### and(...rules)

You can pass a list of rules to the `and` rule. The access will be granted if all of them would grant access.

See below for an example.

### not(rule)

You need to pass a rule as parameter to this rule. The access will be granted only if the parameter rule doesn't grant access.

See below for an example.

### member(field)

The `member` function will grant access to people whose `id` denote an entity that belongs to the `field` array property. The `id` is decoded from the JWT token received with the request.

```javascript
const { is, not, member, and } = require('simple-ql');
const rules = {
  User : {
    contacts : {
      add : and(
        is('self'),              //Only oneself can add contacts
        not(member('contacts'))  //Cannot add ourselves as our own contact
      )
    }
  }
}
```

### count(field, constraints)

The count rule ensure that the elements of the `field` array property match the constraints.

Constraints must follow this form:

    const constraints = {
      amount : x, // There should be exactly x elements in the array
      min : x,    // There should be at least x elements in the array
      max : x,    // There should be at most x elements in the array
    }

Those 3 parameters are optional, but there must at least be one parameter provided, and you cannot provide `min` nor `max` if `amount` is provided.

**Example**

```javascript
const { none, count, member, and } = require('simple-ql');
const rules = {
  Feed : {
    participants: {
      add : none,           //Once the feed is created, no one can add participants
      remove : none,        //Once the feed is created, no one can remove participants
    },
    delete : none,          //No one can delete a feed
    create : and(
      member('participants'), //Users always need to be a member of the feed they wish to create
      count('participants', { amount: 2 }) //When creating a Feed, the amount of participants must equal 2
    ),
  }
```

### isEqual(field, target)

The count rule ensure that the elements of the `field` array property match the target.

Target can be any primitive: a **Date**, a **string**, a **number**, a **boolean**, **null**, **undefined**

Those 3 parameters are optional, but there must at least be one parameter provided, and you cannot provide `min` nor `max` if `amount` is provided.

**Example**

```javascript
const { none, count, member, and } = require('simple-ql');
const rules = {
  Feed : {
    participants: {
      add : none,           //Once the feed is created, no one can add participants
      remove : none,        //Once the feed is created, no one can remove participants
    },
    delete : none,          //No one can delete a feed
    create : and(
      member('participants'), //Users always need to be a member of the feed they wish to create
      count('participants', { amount: 2 }) //When creating a Feed, the amount of participants must equal 2
    ),
  }
```

## Creating your own rule

Of course, you will probably need to configure some custom rules that cannot be expressed with the rules we are currently providing. In this case, you can create your own rule.

The rule should be a function taking an object as parameter, and returning a function.

The parameter object will have the following properties:

 * **tables** : The tables as they were created (see prepare your tables)
 * **tableName** : The name of the current table

The function returned by the rule should take an object as parameter with the following properties:

 * **authId** : The id used to identify the user making the request.
 * **request** : The portion of the request relative to the current table.
 * **object** : The result of this portion of the request.
 * **query** : A function that can make a SimpleQL query to the database (see query).

This function should return a promise that would resolve if the user is allowed to execute this request, and reject if the user should be denied access.

### query function

The query function provided can be used to make SimpleQL requests to the database. This function takes 2 parameters: the SimpleQL request, and an optional object having the following properties:

 * **admin** *(boolean : default false)* : indicate that the request should be made with admin credentials. Be careful, this will ignore all access rules.
 * **readOnly** *(boolean : default false)* : indicate that the request should only read data and is not allowed to make any change to the database.

**Example**

```javascript
//This rule will controle read access to Comments made in a Feed.
function commentRule({tables, tableName}) {
  return ({query, object, authId, request}) => {
    //In case of message creation, the feed might not exist yet but we don't mind reading the data anyway
    if(request.create) return Promise.resolve();
    //We want to make sure that only participants of a feed can read the messages from that feed.
    return query({
      //We look for feeds containing that comment, and the author as participant
      Feed: {
        comments: { reservedId : object.reservedId },
        participants: {
          reservedId : authId,
        }
      }
    },
    //We give admin rights to this request to be able to read the data from the database, but we set readOnly mode to be safer.
    { admin: true, readOnly : true }).then(results => {
      //If we found no Feed matching the request, we reject the access to the message.
      return results.Feed.length>0 ? Promise.resolve() : Promise.reject('Only feed participants can read message content');
    });
  };
}
```
