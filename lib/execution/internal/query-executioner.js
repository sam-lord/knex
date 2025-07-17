const _debugQuery = require('debug')('knex:query');
const debugBindings = require('debug')('knex:bindings');
const _debugResult = require('debug')('knex:result');
const debugQuery = (sql, txId) => _debugQuery((sql || '').replace(/%/g, '%%'), txId);
const debugResult = (result, txId) => _debugResult(JSON.stringify(result), txId);
const { isString } = require('../../util/is');

function formatQuery(sql, bindings, timeZone, client) {
  if (!sql || typeof sql !== 'string') {
    return String(sql || '');
  }
  bindings = bindings == null ? [] : [].concat(bindings);
  let index = 0;
  return sql.replace(/\\?\?/g, (match) => {
    if (match === '\\?') {
      return '?';
    }
    if (index === bindings.length) {
      return match;
    }
    const value = bindings[index++];
    return client._escapeBinding(value, { timeZone });
  });
}

function enrichQueryObject(connection, queryParam, client) {
  const queryObject = isString(queryParam) ? { sql: queryParam } : queryParam;

  queryObject.bindings = client.prepBindings(queryObject.bindings);
  queryObject.sql = client.positionBindings(queryObject.sql);

  const { __knexUid, __knexTxId } = connection;

  client.emit('query', Object.assign({ __knexUid, __knexTxId }, queryObject));
  debugQuery(queryObject.sql, __knexTxId);
  debugBindings(queryObject.bindings, __knexTxId);

  return queryObject;
}

function executeQuery(connection, queryObject, client) {
  return client._query(connection, queryObject).then((result) => {
    if ('response' in result) {
      debugResult(result.response, connection.__knexTxId);
    }
    return result;
  }).catch((err) => {
    if (client.config && client.config.compileSqlOnError === false) {
      err.message = queryObject.sql + ' - ' + err.message;
    } else {
      err.message =
        formatQuery(queryObject.sql, queryObject.bindings, undefined, client) +
        ' - ' +
        err.message;
    }
    client.emit(
      'query-error',
      err,
      Object.assign(
        { __knexUid: connection.__knexUid, __knexTxId: connection.__knexUid },
        queryObject
      )
    );
    throw err;
  });
}

module.exports = {
  enrichQueryObject,
  executeQuery,
  formatQuery,
};
