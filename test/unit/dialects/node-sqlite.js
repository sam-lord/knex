const { expect } = require('chai');

const Client = require('../../../lib/dialects/node-sqlite');

describe('Node SQLite Dialect', () => {
  let client;

  beforeEach(() => {
    client = new Client({
      client: 'node-sqlite',
      connection: {
        filename: ':memory:'
      }
    });
  });

  it('should have the correct dialect name', () => {
    expect(client.dialect).to.equal('node-sqlite');
  });

  it('should have the correct driver name', () => {
    expect(client.driverName).to.equal('node-sqlite');
  });

  it('should return node:sqlite driver', () => {
    // This test will likely fail in environments without --experimental-sqlite
    // but validates the expected interface
    expect(() => client._driver()).to.not.throw();
  });

  it('should warn about useNullAsDefault', () => {
    let warningCalled = false;
    const mockLogger = {
      warn: (message) => {
        if (message.includes('useNullAsDefault')) {
          warningCalled = true;
        }
      }
    };
    
    new Client({
      client: 'node-sqlite',
      connection: { filename: ':memory:' },
      logger: mockLogger
    });
    
    expect(warningCalled).to.be.true;
  });

  it('should warn about filename when undefined', () => {
    let warningCalled = false;
    const mockLogger = {
      warn: (message) => {
        if (message.includes('connection.filename')) {
          warningCalled = true;
        }
      }
    };
    
    new Client({
      client: 'node-sqlite',
      connection: {},
      logger: mockLogger
    });
    
    expect(warningCalled).to.be.true;
  });

  describe('processResponse', () => {
    it('should return array for raw queries', () => {
      const obj = {
        method: 'raw',
        response: [{ name: 'table1' }, { name: 'table2' }],
        context: {}
      };
      
      const result = client.processResponse(obj, {});
      expect(result).to.be.an('array');
      expect(result).to.deep.equal([{ name: 'table1' }, { name: 'table2' }]);
    });

    it('should return empty array for raw queries with no response', () => {
      const obj = {
        method: 'raw',
        response: null,
        context: {}
      };
      
      const result = client.processResponse(obj, {});
      expect(result).to.be.an('array');
      expect(result).to.deep.equal([]);
    });

    it('should handle raw queries consistently with sqlite3', () => {
      const obj = {
        method: 'raw',
        response: [
          { name: 'sqlite_master', type: 'table' },
          { name: 'users', type: 'table' }
        ],
        context: {}
      };
      
      const result = client.processResponse(obj, {});
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(2);
      expect(result[0]).to.have.property('name', 'sqlite_master');
      expect(result[1]).to.have.property('name', 'users');
    });
  });
});