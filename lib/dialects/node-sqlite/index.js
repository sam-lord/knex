// Node.js native SQLite Client
// -------
const Client_SQLite3 = require('../sqlite3');

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
      // Enable WAL mode for better concurrent access
      db.prepare('PRAGMA journal_mode = WAL').run();

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
    // Node's native SQLite doesn't have an explicit close method yet
    // The connection will be garbage collected when it goes out of scope
    return Promise.resolve();
  }

  // Runs the query on the specified connection, providing the bindings and any
  // other necessary prep work.
  async _query(connection, obj) {
    if (!obj.sql) throw new Error('The query is empty');

    if (!connection) {
      throw new Error('No connection provided');
    }

    const { method } = obj;
    const bindings = this._formatBindings(obj.bindings, obj.sql, method);

    let response;
    let context = {};

    try {
      if (method === 'select' || method === 'first' || method === 'pluck' || method === 'columnInfo' ||
          (method === 'raw' && (obj.sql.trim().toLowerCase().startsWith('select') ||
           obj.sql.trim().toLowerCase().startsWith('pragma'))) ||
          (!method && (obj.sql.trim().toLowerCase().startsWith('select') ||
           obj.sql.trim().toLowerCase().startsWith('pragma')))) {
        // For SELECT queries, use prepare and get appropriate method
        const statement = connection.prepare(obj.sql);
        if (method === 'first') {
          response = statement.get(...bindings);
          response = response ? [response] : [];
        } else {
          response = statement.all(...bindings);
        }

        // Post-process response to fix numeric string conversion
        response = this._postProcessResponse(response);
      } else if ((method === 'insert' || method === 'update') && obj.returning) {
        // For INSERT/UPDATE with RETURNING clause, use all() to get result rows
        const statement = connection.prepare(obj.sql);
        response = statement.all(...bindings);

        // Post-process response to fix numeric string conversion
        response = this._postProcessResponse(response);

        // Still need context for fallback behavior
        const result = { lastInsertRowid: 0, changes: 0 };
        if (response && response.length > 0) {
          // Try to extract metadata if available (some queries may include rowid)
          const firstRow = response[0];
          if (firstRow && typeof firstRow.rowid !== 'undefined') {
            result.lastInsertRowid = firstRow.rowid;
          }
          if (method === 'update') {
            result.changes = response.length;
          }
        }
        context = {
          lastID: result.lastInsertRowid,
          changes: result.changes,
        };
      } else {
        // For INSERT, UPDATE, DELETE without RETURNING, use prepare and run
        const statement = connection.prepare(obj.sql);
        const result = statement.run(...bindings);

        response = result;
        context = {
          lastID: result.lastInsertRowid,
          changes: result.changes,
        };
      }
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

      throw err;
    }

    obj.response = response;
    obj.context = context;

    return obj;
  }

  _formatBindings(bindings, sql, method) {
    if (!bindings) {
      return [];
    }

    return bindings.map((binding) => {
      if (binding instanceof Date) {
        return binding.valueOf();
      }

      if (typeof binding === 'boolean') {
        return Number(binding);
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
    const ctx = obj.context || {};
    const { response, returning } = obj;

    if (obj.output) return obj.output.call(runner, response);

    switch (obj.method) {
      case 'select':
        return response || [];
      case 'first':
        return response && response.length > 0 ? response[0] : undefined;
      case 'pluck':
        return response ? response.map(row => row[obj.pluck]) : [];
      case 'insert': {
        if (returning) {
          if (response && Array.isArray(response)) {
            return response;
          }
        }
        return [ctx.lastID];
      }
      case 'update': {
        if (returning) {
          if (response && Array.isArray(response)) {
            return response;
          }
        }
        return ctx.changes || 0;
      }
      case 'del':
      case 'counter':
        return ctx.changes || 0;
      case 'raw':
        return response || [];
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
