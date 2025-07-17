// Node.js native SQLite Client
// -------
const Client_SQLite3 = require('../sqlite3');
const debug = require('debug')('knex:node-sqlite');

class Client_NodeSQLite extends Client_SQLite3 {
  _driver() {
    return require('node:sqlite');
  }

  // Get a raw connection from the database, returning a promise with the connection object.
  async acquireRawConnection() {
    const { DatabaseSync } = this.driver;
    const filename = this.connectionSettings.filename || ':memory:';

    const options = {
      enableDoubleQuotedStringLiterals: true
    };
    if (this.connectionSettings.options) {
      // Apply any additional options that might be supported
      Object.assign(options, this.connectionSettings.options);
    }

    // Create the database synchronously (Node's native SQLite is sync-only)
    const db = new DatabaseSync(filename, options);

    // Configure SQLite settings for better compatibility and performance
    try {
      // Disable foreign keys by default to match sqlite3 behavior
      db.prepare('PRAGMA foreign_keys = OFF').run();
    } catch (err) {
      // Ignore errors if pragma is not supported
    }

    // Wrap in a promise for consistency with other dialects
    return Promise.resolve(db);
  }

  // Used to explicitly close a connection, called internally by the pool when
  // a connection times out or the pool is shutdown.
  async destroyRawConnection(connection) {
    connection.close();
    return Promise.resolve();
  }

  // Runs the query on the specified connection, providing the bindings and any
  // other necessary prep work.
  _query(connection, obj) {
    if (!obj.sql) throw new Error('The query is empty');

    if (!connection) {
      throw new Error('No connection provided');
    }

    const { method } = obj;
    let callMethod;
    switch (method) {
      case 'insert':
      case 'update':
        callMethod = obj.returning ? 'all' : 'run';
        break;
      case 'counter':
      case 'del':
        callMethod = 'run';
        break;
      default:
        callMethod = 'all';
    }

    const bindings = this._formatBindings(obj.bindings);

    return new Promise((resolver, rejecter) => {
      try {
        const statement = connection.prepare(obj.sql);

        if (callMethod === 'all') {
          const response = statement.all(...bindings);
          debug('Exeucted SQL: ', statement.expandedSQL);
          obj.response = this._postProcessResponse(response);
          // For SELECT queries, create a dummy context similar to sqlite3
          obj.context = { lastID: 0, changes: 0 };
        } else if (callMethod === 'run') {
          const result = statement.run(...bindings);
          obj.response = result;
          // We need the context here, as it contains
          // the "lastID" or "changes" - mimic sqlite3 behavior
          obj.context = {
            lastID: result.lastInsertRowid,
            changes: result.changes,
          };
        }

        return resolver(obj);
      } catch (err) {
        // Transform error messages and codes to match sqlite3 format
        if (err.message && typeof err.message === 'string') {
          let message = err.message;

          // Convert node-sqlite constraint error format to sqlite3 format
          if (message.includes('constraint failed') && !message.includes('SQLITE_CONSTRAINT:')) {
            message = 'SQLITE_CONSTRAINT: ' + message;
          }

          // Handle other common SQLite error format differences
          if (message.includes('ERR_SQLITE_ERROR')) {
            message = message.replace('ERR_SQLITE_ERROR', 'SQLITE_ERROR');
          }

          err.message = message;
        }

        // Transform error codes to match sqlite3 format
        if (err.code === 'ERR_SQLITE_ERROR') {
          err.code = 'SQLITE_ERROR';
        }

        return rejecter(err);
      }
    });
  }

  _formatBindings(bindings) {
    if (!bindings) {
      return [];
    }

    return bindings.map((binding) => {
      if (binding === null || binding === undefined) {
        return null;
      }

      if (binding instanceof Date) {
        return binding.toISOString();
      }

      if (typeof binding === 'boolean') {
        return binding ? 1 : 0;
      }

      if (typeof binding === 'bigint') {
        return Number(binding);
      }

      if (typeof binding === 'number') {
        // Manually convert numbers to string. They'll be converted back to numbers when parsed by SQLite if the datatype is INTEGER/REAL.
        return binding.toString();
      }

      return binding;
    });
  }

  _postProcessResponse(response) {
    if (Array.isArray(response)) {
      return response.map(row => {
        if (row && typeof row === 'object') {
          const processedRow = {};
          for (const [key, value] of Object.entries(row)) {
            processedRow[key] = value;
          }
          return processedRow;
        }
        return row;
      });
    }
    return response;
  }

  // Node's native SQLite is synchronous, so we need to handle streaming differently
  _stream(connection, obj, stream) {
    if (!obj.sql) throw new Error('The query is empty');

    const client = this;
    return new Promise(function (resolver, rejecter) {
      stream.on('error', rejecter);
      stream.on('end', resolver);

      return client
        ._query(connection, obj)
        .then((obj) => obj.response)
        .then((rows) => {
          if (Array.isArray(rows)) {
            rows.forEach((row) => stream.write(row));
          }
        })
        .catch(function (err) {
          stream.emit('error', err);
        })
        .then(function () {
          stream.end();
        });
    });
  }

  // Override acquireConnection to provide better error messages for SQLite
  async acquireConnection() {
    try {
      return await super.acquireConnection();
    } catch (error) {
      if (error.message && error.message.includes('Timeout acquiring a connection')) {
        error.message = error.message +
          '\n\nSQLite Connection Issue: SQLite only supports a single connection per database file.' +
          '\nIf you\'re using transactions, make sure all queries use the transaction context (trx) instead of the main knex instance.' +
          '\nExample: Use `trx(\'table\').select()` instead of `knex(\'table\').select()` within transactions.' +
          '\nFor ORMs like Bookshelf, ensure models are properly configured to use the transaction context.';
      }
      throw error;
    }
  }

  // Override processResponse to handle the native SQLite response format
  processResponse(obj, runner) {
    const ctx = obj.context;
    const { response, returning } = obj;
    if (obj.output) return obj.output.call(runner, response);
    switch (obj.method) {
      case 'select':
        return response;
      case 'first':
        return response[0];
      case 'pluck':
        return response.map(row => row[obj.pluck]);
      case 'insert': {
        if (returning) {
          if (response) {
            return response;
          }
        }
        return [ctx.lastID];
      }
      case 'update': {
        if (returning) {
          if (response) {
            return response;
          }
        }
        return ctx.changes;
      }
      case 'del':
      case 'counter':
        return ctx.changes;
      default: {
        return response;
      }
    }
  }
}

Object.assign(Client_NodeSQLite.prototype, {
  dialect: 'node-sqlite',
  driverName: 'node-sqlite',
});

module.exports = Client_NodeSQLite;
