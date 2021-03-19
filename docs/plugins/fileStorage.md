# File Storage

This server will handle users authentication, and can receive files, manage folders, limit users space...

## Log in / Sign up

Registration and connection are made with the [Login Plugin](https://github.com/Sharcoux/SimpleQL/blob/master/docs/plugins/login.md) of Simple QL framework.

## Space limit per user

The default user space is limited by the `USER_SPACE` environment variable.

## Send a file

### Send a single file

This is how you can send a file after you logged in

```javascript
{
  File: {
    name: 'subfolders/myfile.ext',
    content: Buffer.from('file data').toString('base64'),
    create: true
  }
}
```

### Send multiple files in base64 encoding

To send multiple files, just use an array.

```javascript
{
  File: [
    {
      name: 'file1.ext',
      content: Buffer.from('file data').toString('base64'),
      create: true
    },
    {
      name: 'file2.ext',
      content: Buffer.from('file data').toString('base64'),
      create: true
    },
  ]
}
```

### Send multiple files as a zip

You can also send a zip that will be unzipped on the server:

```javascript
{
  File: {
    name: 'subfolders/myfile.ext',
    content: Buffer.from('zipped data').toString('base64'),
    zip: true,
    create: true
  }
}
```

## Update file content

To update file content, do as follow:

### Update file by file

```javascript
{
  File: {
    name: 'subfolders/myfile.ext',
    set: {
      content: Buffer.from('file data').toString('base64'),
    }
  }
}
```

### Update with a zip

You can update a whole directory by sending a zip:

```javascript
{
  File: {
    name: 'subfolders/myfile.ext',
    zip: true,
    set: {
      content: Buffer.from('zipped data').toString('base64'),
    }
  }
}
```

**Note:** This is exactly the same as using `create` in this case.

## Read file content

### Read file by file

To get the content of a file, just use this request:

```javascript
{
  File: {
    name: 'subfolders/myfile.ext',
    get: ['content']
  }
}
```

You will receive **base64 encoded** data. Use `Buffer.from(content, 'base64')` to get the file's content.

### Get multiple files as a zip

You can get multiple files, like a whole folder, as a zip file:

```javascript
{
  File: {
    name: 'subfolders',
    zip: true,
  }
}
```

You should receive something like that:

```javascript
{
  File: [{
    name: 'subfolders',
    zip: true,
    content: 'base64 encoded zipped data',
    files: ['subfolder/file1.txt', 'subfolder/subfolder2/file2.txt', 'etc.jpg']//The list of file paths
  }]
}
```

## Delete files

You can delete a file this way:

```javascript
{
  File: {
    name: 'subfolders/myfile.ext',
    delete: true,
  }
}
```

Delete a complete folder with this request:

```javascript
{
  File: {
    name: 'subfolders/',
    delete: true,
  }
}
```
