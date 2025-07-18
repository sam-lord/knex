'use strict';
/* eslint no-var: 0 */

const assert = require('assert');
const { promisify } = require('util');
const testConfig =
  (process.env.KNEX_TEST && require(process.env.KNEX_TEST)) || {};
const _ = require('lodash');

// excluding redshift, oracle, and mssql dialects from default integrations test
const testIntegrationDialects = (
  process.env.DB ||
  'sqlite3 postgres pgnative mysql mysql2 mssql oracledb cockroachdb better-sqlite3 node-sqlite'
).match(/[\w-]+/g);

console.log(`ENV DB: ${process.env.DB}`);

const pool = {
  afterCreate: function (connection, callback) {
    assert.ok(typeof connection.__knexUid !== 'undefined');
    callback(null, connection);
  },
};

const poolSqlite = {
  min: 0,
  max: 1,
  acquireTimeoutMillis: 1000,
  afterCreate: function (connection, callback) {
    assert.ok(typeof connection.__knexUid !== 'undefined');
    connection.run('PRAGMA foreign_keys = ON', callback);
  },
};

const poolNodeSqlite = {
  min: 0,
  max: 1,
  acquireTimeoutMillis: 1000,
  afterCreate: function (connection, callback) {
    assert.ok(typeof connection.__knexUid !== 'undefined');
    try {
      connection.prepare('PRAGMA foreign_keys = ON').run();
      callback(null, connection);
    } catch (err) {
      callback(err, connection);
    }
  },
};

const poolBetterSqlite = {
  min: 0,
  max: 1,
  acquireTimeoutMillis: 1000,
  afterCreate: function (connection, callback) {
    assert.ok(typeof connection.__knexUid !== 'undefined');
    connection.prepare('PRAGMA foreign_keys = ON').run();
    callback(null, connection);
  },
};

const mysqlPool = _.extend({}, pool, {
  afterCreate: function (connection, callback) {
    promisify(connection.query)
      .call(connection, "SET sql_mode='TRADITIONAL';", [])
      .then(function () {
        callback(null, connection);
      });
  },
});

const migrations = {
  directory: 'test/integration/migrate/migration',
};

const seeds = {
  directory: 'test/integration/seed/seeds',
};

const testConfigs = {
  mysql: {
    client: 'mysql',
    connection: testConfig.mysql || {
      port: 23306,
      database: 'knex_test',
      host: 'localhost',
      user: 'testuser',
      password: 'testpassword',
      charset: 'utf8',
    },
    pool: mysqlPool,
    migrations,
    seeds,
  },

  mysql2: {
    client: 'mysql2',
    connection: testConfig.mysql || {
      port: 23306,
      database: 'knex_test',
      host: 'localhost',
      user: 'testuser',
      password: 'testpassword',
      charset: 'utf8',
    },
    pool: mysqlPool,
    migrations,
    seeds,
  },

  oracledb: {
    client: 'oracledb',
    connection: testConfig.oracledb || {
      user: 'system',
      password: 'Oracle18',
      connectString: 'localhost:21521/XE',
      // https://github.com/oracle/node-oracledb/issues/525
      stmtCacheSize: 0,
    },
    pool,
    migrations,
  },

  postgres: {
    client: 'postgres',
    connection: testConfig.postgres || {
      adapter: 'postgresql',
      port: 25432,
      host: 'localhost',
      database: 'knex_test',
      user: 'testuser',
      password: 'knextest',
    },
    pool,
    migrations,
    seeds,
  },

  cockroachdb: {
    client: 'cockroachdb',
    connection: testConfig.cockroachdb || {
      adapter: 'cockroachdb',
      port: 26257,
      host: 'localhost',
      database: 'test',
      user: 'root',
      password: undefined,
    },
    pool,
    migrations,
    seeds,
  },

  pgnative: {
    client: 'pgnative',
    connection: testConfig.pgnative || {
      adapter: 'postgresql',
      port: 25433,
      host: 'localhost',
      database: 'knex_test',
      user: 'testuser',
      password: 'knextest',
    },
    pool,
    migrations,
    seeds,
  },

  redshift: {
    client: 'redshift',
    connection: testConfig.redshift || {
      adapter: 'postgresql',
      database: 'knex_test',
      user: process.env.REDSHIFT_USER || 'postgres',
      password: process.env.REDSHIFT_PASSWORD || '',
      port: '5439',
      host: process.env.REDSHIFT_HOST || '127.0.0.1',
    },
    pool,
    migrations,
    seeds,
  },

  sqlite3: {
    client: 'sqlite3',
    connection: testConfig.sqlite3 || {
      filename: __dirname + '/test.sqlite3',
    },
    pool: poolSqlite,
    migrations,
    seeds,
  },

  'node-sqlite': {
    client: 'node-sqlite',
    connection: testConfig.sqlite3 || {
      filename: __dirname + '/test.sqlite3',
    },
    pool: poolNodeSqlite,
    migrations,
    seeds,
    useNullAsDefault: true,
  },

  'better-sqlite3': {
    client: 'better-sqlite3',
    connection: testConfig.sqlite3 || {
      filename: __dirname + '/test.sqlite3',
    },
    pool: poolBetterSqlite,
    migrations,
    seeds,
  },

  mssql: {
    client: 'mssql',
    connection: testConfig.mssql || {
      user: 'sa',
      password: 'S0meVeryHardPassword',
      server: 'localhost',
      port: 21433,
      database: 'knex_test',
    },
    pool: pool,
    migrations,
    seeds,
  },
};

// export only copy the specified dialects
module.exports = _.reduce(
  testIntegrationDialects,
  function (res, dialectName) {
    res[dialectName] = testConfigs[dialectName];
    return res;
  },
  {}
);
