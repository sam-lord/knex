# Node.js Native SQLite Dialect

This dialect enables Knex.js to work with Node.js's experimental native SQLite bindings introduced in Node.js 22.5.0.

## Requirements

- Node.js 22.5.0 or later
- The `--experimental-sqlite` flag must be used when running Node.js

## Usage

```javascript
const knex = require('knex')({
  client: 'node-sqlite',
  connection: {
    filename: './database.sqlite3'  // or ':memory:' for in-memory database
  },
  useNullAsDefault: true
});
```

## Configuration Options

### Connection

```javascript
{
  filename: string,  // Path to SQLite file or ':memory:' for in-memory
  options?: {        // Optional additional options (currently experimental)
    [key: string]: any
  }
}
```

## Key Features

- Synchronous SQLite operations (Node's native SQLite is sync-only)
- Full Knex.js API compatibility
- Supports file-based and in-memory databases
- Automatic type conversion between JavaScript and SQLite
- Prepared statements for performance and security

## Example

```javascript
// Run with: node --experimental-sqlite app.js

const knex = require('knex')({
  client: 'node-sqlite',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

async function example() {
  // Create table
  await knex.schema.createTable('users', table => {
    table.increments('id');
    table.string('name');
    table.string('email');
  });

  // Insert data
  await knex('users').insert([
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' }
  ]);

  // Query data
  const users = await knex('users').select('*');
  console.log(users);

  await knex.destroy();
}

example();
```

## Important Notes

1. **Experimental Feature**: Node.js native SQLite is experimental and may change
2. **Synchronous Only**: Unlike other drivers, Node's SQLite is synchronous
3. **Flag Required**: Must use `--experimental-sqlite` flag
4. **Limited Production Use**: Not recommended for production until stabilized

## Migration from other SQLite drivers

From `sqlite3`:
```javascript
// Before
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './db.sqlite3' }
});

// After
const knex = require('knex')({
  client: 'node-sqlite',
  connection: { filename: './db.sqlite3' }
});
```

The API remains identical, just change the client name and ensure you're running with the experimental flag.