const { expect } = require('chai');
const knex = require('../../../knex');

describe('Node SQLite Integration Tests', function () {
  let connection;

  before(function () {
    // Skip if node:sqlite is not available
    try {
      require('node:sqlite');
    } catch (err) {
      this.skip();
    }
  });

  beforeEach(function () {
    connection = knex({
      client: 'node-sqlite',
      connection: {
        filename: ':memory:'
      },
      useNullAsDefault: true
    });
  });

  afterEach(async function () {
    if (connection) {
      await connection.destroy();
    }
  });

  describe('Foreign key handling', function () {
    it('should have foreign keys disabled by default to match sqlite3', async function () {
      const result = await connection.raw('PRAGMA foreign_keys;');
      expect(result).to.be.an('array');
      expect(result[0]).to.have.property('foreign_keys', 0);
    });

    it('should allow dropping tables with foreign key references', async function () {
      // Create parent table
      await connection.schema.createTable('users', function (table) {
        table.increments('id');
        table.string('name');
      });

      // Create child table with foreign key
      await connection.schema.createTable('posts', function (table) {
        table.increments('id');
        table.string('title');
        table.integer('user_id').references('id').inTable('users');
      });

      // Insert test data
      await connection('users').insert({ name: 'Test User' });
      await connection('posts').insert({ title: 'Test Post', user_id: 1 });

      // This should work without foreign key constraint errors
      await connection.schema.dropTableIfExists('posts');
      await connection.schema.dropTableIfExists('users');
    });

    it('should support double quoted string literals', async function () {
      await connection.schema.createTable('test_quotes', function (table) {
        table.increments('id');
        table.string('value');
      });

      // This should work with double quoted strings (matching sqlite3 behavior)
      const result = await connection.raw('SELECT "test string" as quoted_value');
      expect(result).to.be.an('array');
      expect(result[0]).to.have.property('quoted_value', 'test string');
    });
  });

  describe('Numeric type handling', function () {
    it('should handle integer IDs correctly', async function () {
      await connection.schema.createTable('test_numbers', function (table) {
        table.increments('id');
        table.integer('int_col');
        table.float('float_col');
      });

      await connection('test_numbers').insert({
        int_col: 42,
        float_col: 3.14
      });

      const result = await connection('test_numbers').select('*').first();

      expect(result.id).to.be.a('number');
      expect(result.id % 1).to.equal(0); // Should be an integer
      expect(result.int_col).to.be.a('number');
      expect(result.int_col % 1).to.equal(0); // Should be an integer
      expect(result.float_col).to.be.a('number');
    });

    it('should maintain integer precision for large numbers', async function () {
      await connection.schema.createTable('test_large_ints', function (table) {
        table.bigInteger('big_int');
      });

      const largeInt = 9007199254740991; // Number.MAX_SAFE_INTEGER
      await connection('test_large_ints').insert({ big_int: largeInt });

      const result = await connection('test_large_ints').select('*').first();
      expect(result.big_int).to.equal(largeInt);
      expect(result.big_int % 1).to.equal(0); // Should be an integer
    });

    it('should handle raw query integer results correctly', async function () {
      await connection.schema.createTable('test_raw_ints', function (table) {
        table.increments('id');
        table.string('name');
      });

      await connection('test_raw_ints').insert([
        { name: 'first' },
        { name: 'second' }
      ]);

      const result = await connection.raw('SELECT id, name FROM test_raw_ints ORDER BY id');

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(2);

      result.forEach((row, index) => {
        console.log(`Row ${index}:`, row, 'id type:', typeof row.id, 'id value:', row.id);
        expect(row.id).to.be.a('number');
        expect(row.id % 1).to.equal(0, `ID ${row.id} should be an integer, not ${row.id}`);
        expect(Number.isInteger(row.id)).to.be.true;
      });
    });

    it('should handle different column types correctly', async function () {
      await connection.schema.createTable('test_types', function (table) {
        table.integer('int_id').primary();
        table.bigInteger('big_int');
        table.float('real_num');
        table.decimal('decimal_num', 10, 2);
        table.boolean('bool_flag');
      });

      await connection('test_types').insert({
        int_id: 1,
        big_int: 123456789,
        real_num: 3.14159,
        decimal_num: 99.99,
        bool_flag: true
      });

      const result = await connection('test_types').select('*').first();

      console.log('All types result:', result);
      console.log('int_id:', result.int_id, 'type:', typeof result.int_id, 'isInteger:', Number.isInteger(result.int_id));
      console.log('big_int:', result.big_int, 'type:', typeof result.big_int, 'isInteger:', Number.isInteger(result.big_int));
      console.log('real_num:', result.real_num, 'type:', typeof result.real_num);
      console.log('decimal_num:', result.decimal_num, 'type:', typeof result.decimal_num);
      console.log('bool_flag:', result.bool_flag, 'type:', typeof result.bool_flag);

      expect(Number.isInteger(result.int_id)).to.be.true;
      expect(Number.isInteger(result.big_int)).to.be.true;
      expect(result.real_num).to.be.a('number');
      expect(result.bool_flag).to.be.a('number'); // SQLite stores booleans as numbers
    });
  });

  describe('Raw queries', function () {
    it('should return an array from raw queries', async function () {
      // Create a test table first
      await connection.schema.createTable('test_table', function (table) {
        table.increments('id');
        table.string('name');
      });

      // Insert some test data
      await connection('test_table').insert([
        { name: 'table1' },
        { name: 'table2' }
      ]);

      // Test the raw query that was failing
      const result = await connection.raw('SELECT name FROM sqlite_master WHERE type=\'table\';');

      expect(result).to.be.an('array');
      expect(result.map).to.be.a('function');

      // Should be able to use .map() on the result
      const tableNames = result.map(table => table.name);
      expect(tableNames).to.include('test_table');
    });

    it('should handle raw queries with no results', async function () {
      const result = await connection.raw('SELECT name FROM sqlite_master WHERE type=\'nonexistent\';');

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(0);
      expect(result.map).to.be.a('function');
    });

    it('should be consistent with sqlite3 dialect behavior', async function () {
      // Create multiple tables
      await connection.schema.createTable('users', function (table) {
        table.increments('id');
        table.string('email');
      });

      await connection.schema.createTable('posts', function (table) {
        table.increments('id');
        table.string('title');
      });

      const result = await connection.raw('SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name;');

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(2);

      // Should be able to process with array methods
      const processedTables = result.map(table => ({
        tableName: table.name,
        type: 'table'
      }));

      expect(processedTables).to.be.an('array');
      expect(processedTables[0]).to.have.property('tableName');
      expect(processedTables[0]).to.have.property('type', 'table');
    });

    it('should return proper structure for SELECT queries', async function () {
      await connection.schema.createTable('sample', function (table) {
        table.increments('id');
        table.string('value');
      });

      await connection('sample').insert({ value: 'test' });

      const result = await connection.raw('SELECT * FROM sample;');

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.have.property('id');
      expect(result[0]).to.have.property('value', 'test');
    });
  });
});
