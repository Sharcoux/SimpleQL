/** This file contains the Driver that will convert SimpleQL requests into MySQL queries **/
const { WRONG_VALUE, CONFLICT, REQUIRED } = require('../errors');

const mysql = {};
try {
  Object.assign(mysql, require('mysql'));
} catch(err) {
  throw new Error('You must run `npm add mysql -S` to be able to use `mysql` database.');
}
const { isPrimitive, operators, sequence } = require('../utils');
const log = require('../utils/logger');

//Shortcuts for escaping
/* Escaping values */
const es = mysql.escape;
/* Escaping identifiers */
const ei = mysql.escapeId;

//TODO : format requests results
class Driver {
  constructor(pool) {
    this.binaries = [];
    this.dates = [];
    this.pool = pool;
    this.connection = pool;
    this.inTransaction = false;
    this.startTransaction = this.startTransaction.bind(this);
    this.commit = this.commit.bind(this);
    this.rollback = this.rollback.bind(this);
    this.query = this.query.bind(this);
    this.get = this.get.bind(this);
    this.update = this.update.bind(this);
    this.create = this.create.bind(this);
    this.delete = this.delete.bind(this);
    this.createTable = this.createTable.bind(this);
    this._escapeValue = this._escapeValue.bind(this);
    this._createQuery = this._createQuery.bind(this);
    this._convertIntoCondition = this._convertIntoCondition.bind(this);
  }
  query(query) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(`timeout for requet ${query}`), 5000);
      log('database query', `Executing ${query}`);
      this.connection.query(query+';', (error, results) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(results);
      });
    });
  }
  destroy() {
    this.connection.end(console.error);
  }
  startTransaction() {
    //We need to ensure that we are using the same connection during the whole transaction
    if(this.inTransaction) return Promise.reject('You already started a transaction. Call `commit()` or `rollback()` to terminate it.');
    this.inTransaction = true;
    return new Promise((resolve, reject) => {
      this.pool.getConnection((err, connection) => {
        if(err) reject(err);
        else {
          this.connection = connection;
          return this.query('START TRANSACTION').then(resolve).catch(reject);
        }
      });
    });
  }
  commit() {
    if(!this.inTransaction) return Promise.reject('You must start a transaction with `startTransaction()` before being able to commit it.');
    return this.query('COMMIT').then(() => {
      this.connection.release();
      this.connection = this.pool;
      this.inTransaction = false;
    });
  }
  rollback() {
    if(!this.inTransaction) return Promise.reject('You must start a transaction with `startTransaction()` before being able to roll it back.');
    return this.query('ROLLBACK').then(() => {
      this.connection.release();
      this.connection = this.pool;
      this.inTransaction = false;
    });
  }
  get({table, search, where, offset, limit, order}) {
    if(!search.length) return Promise.resolve([]);
    //If a condition specify that no value is accepted for a column, no result will match the constraint
    if(Object.values(where).find(v => Array.isArray(v) && v.length===0)) return Promise.resolve([]);
    let query = this._createQuery(`SELECT ${search.map(s => ei(s)).join(', ')} FROM ${ei(table)}`, where, table);
    //order: ['name', '-age'] will sort by ascending name and descending age
    if(order) query += ` ORDER BY ${order.map(column => (column.startsWith('-') ? `${ei(column.substring(1))} DESC` : `${ei(column)} ASC`)).join(', ')}`;
    if(limit) query += ` LIMIT ${es(parseInt(limit, 10))}`;
    if(offset) query += ` OFFSET ${es(parseInt(offset, 10))}`;
    return this.query(query).catch(errorHandler(table)).then(results => {
      log('database result', JSON.stringify(results));
      return Array.isArray(results) ? results : [results];
    });
  }
  delete({table, where}) {
    //If a condition specify that no value is accepted for a column, no result will match the constraint
    if(Object.values(where).find(v => Array.isArray(v) && v.length===0)) return Promise.resolve([]);
    const query = this._createQuery(`DELETE FROM ${ei(table)}`, where, table);
    return this.query(query).catch(errorHandler(table));
  }
  create({table, elements}) {
    if(!elements) return Promise.resolve();
    let list = Array.isArray(elements) ? elements : [elements];
    //For each property provided as an array, we duplicate the elements to be created. {a : [1, 2]} becomes [{a: 1}, {a : 2}].
    [...list].forEach(elt => {
      Object.keys(elt).forEach(key => {
        const val = elt[key];
        if(Array.isArray(val)) {
          const L = [];
          val.forEach(v => list.forEach(e => L.push({...e, [key] : v})));
          list = L;
        }
      });
    });
    
    return sequence(list.map(element => () => {
      const query = `INSERT INTO ${ei(table)} (
        ${Object.keys(element).map(k => ei(k)).join(', ')}
      ) VALUES (
        ${Object.keys(element).map(k => this._escapeValue(table, k, element[k])).join(', ')}
      )`;
      return this.query(query).catch(errorHandler(table)).then(results => Array.isArray(results) ? results.map(result => result.insertId) : results.insertId);
    }));
  }
  _escapeValue(table, key, value) {
    return value===null ? 'NULL'
      : this.binaries.includes(table+'.'+key)
        ? `0x${value.toString('hex')}`
        : this.dates.includes(table+'.'+key)
          ? es(new Date(value))
          : es(value);
  }
  update({table, values, where}) {
    //If a condition specify that no value is accepted for a column, no result will match the constraint
    if(Object.values(where).find(v => Array.isArray(v) && v.length===0)) return Promise.resolve([]);
    const setQuery = Object.keys(values).map(key => {
      const value = values[key];
      return `${ei(key)}=${this._escapeValue(table, key, value)}`;
    }).join(', ');
    const query = this._createQuery(`UPDATE ${ei(table)} SET ${setQuery}`, where, table);
    return this.query(query).catch(errorHandler(table));
  }
  createTable({table = '', data = {}, index = []}) {
    const columnsKeys = Object.keys(data).filter(key => key!=='index');
    const columns = columnsKeys.map(name => {
      const { type, length, unsigned, notNull, defaultValue, autoIncrement } = data[name];
      //We record binary columns to not escape their values during INSERT or UPDATE
      if(type==='binary' || type==='varbinary') this.binaries.push(`${table}.${name}`);
      if((type==='string' || type==='varchar' || type==='varbinary') && !length) throw new Error(`You must specify the length of columns of type ${type}, such as ${name} in ${table}.`);
      else if(type==='dateTime') this.dates.push(`${table}.${name}`);

      let query = `${name} ${convertType(type)}`;
      if(length) query += `(${length})`;
      if(unsigned) query += ' UNSIGNED';
      if(notNull) query += ' NOT NULL';
      if(defaultValue) query += ` DEFAULT ${this._escapeValue(table, name, defaultValue)}`;
      if(autoIncrement) query += ' AUTO_INCREMENT';
      return query;
    });
    //Create indexes
    const indexes = index.map(elt => {
      const type = elt.type ? elt.type.toUpperCase()+' ' : '';
      if(!elt.column) throw new Error(`No column was defined for index ${elt} in table ${table}.`);
      if(Array.isArray(elt.column)) {
        if(elt.length && (!Array.isArray(elt.length) || elt.length.length!==elt.column.length)) throw new Error(`length in index definition of table ${table} must be an array matching the column array.`);
        const indexName = `I_${table}${elt.column.map(column => '_'+column).join('')}`;
        const columns = elt.column.map((column, i) => column + (elt.length ? `(${elt.length[i]})` : '')).join(', ');
        return `, ${type}INDEX ${indexName} (${columns})`;
      } else {
        const column = elt.column + (elt.length ? `(${elt.length})` : '');
        return `, ${type}INDEX I_${table}_${elt.column} (${column})`;
      }
    });
    //Create the table
    return this.query(`CREATE TABLE IF NOT EXISTS ${table} (
      ${columns.join(',\n      ')}
      ${indexes.join('\n      ')}
      , CONSTRAINT PK_${table} PRIMARY KEY (reservedId)
    )`).catch(errorHandler(table));
  }
  createForeignKeys(foreignKeys = {}) {
    return sequence(Object.keys(foreignKeys).map(tableName => () => {
      const keys = Object.keys(foreignKeys[tableName]);
      const query = keys.map(key => `ADD CONSTRAINT FK_${tableName}_${key} FOREIGN KEY (${key}) REFERENCES ${foreignKeys[tableName][key]}(reservedId) ON DELETE CASCADE ON UPDATE CASCADE`).join(',\n       ');
      return this.query(`
        ALTER TABLE ${tableName}
        ${query}
      `).catch(errorHandler(tableName));
    }));
  }

  _createQuery(base, where, table) {
    if(!where || !Object.keys(where).length) return base;
    return `${base} WHERE ${this._convertIntoCondition(where, table)}`;
  }
  
  _convertIntoCondition(conditions, table, operator = '=') {
    return Object.keys(conditions).map(key => {
      const writeValue = (value, operator) => {
        switch(operator) {
          case 'ge':
          case 'gt':
          case 'le':
          case 'lt':
          case '~':
            return `${ei(key)} ${operatorsMap[operator]} ${this._escapeValue(table, key, value)}`;
          case '>':
          case '<':
          case '>=':
          case '<=':
          case 'like':
            return `${ei(key)} ${operator.toUpperCase()} ${this._escapeValue(table, key, value)}`;
          case '!':
          case 'not':
            return value===null ? `${ei(key)} IS NOT NULL` : `${ei(key)}!=${this._escapeValue(table, key, value)}`;
          default:
            return value===null ? `${ei(key)} IS NULL` : `${ei(key)}=${this._escapeValue(table, key, value)}`;
        }
      };
      const writeCondition = (value, operator = '=') => {
        if(isPrimitive(value)) return writeValue(value, operator);
        if(['not', '!'].includes(operator)) return 'NOT ('+writeCondition(value)+')';
        if(Array.isArray(value)) return '('+value.map(v => writeCondition(v, operator)).join(' OR ')+')';
        else if(value instanceof Object) return '('+Object.keys(value).map(k => {
          if(!operators.includes(k)) throw new Error(`${k} is not a valid constraint for key ${key}`);
          if(!['not', '!', '='].includes(operator)) throw new Error(`${k} connot be combined with operator ${operator} in key ${key}`);
          return writeCondition(value[k], k);
        }).join(' AND ')+')';
        throw new Error(`Should not be possible. We received this weird value : ${JSON.stringify(value)} which was nor object, nor array, nor primitive.`);
      };
      return writeCondition(conditions[key], operator);
    }).join(' AND ');
  }
  
}

const operatorsMap = {
  ge : '>=',
  gt : '>',
  le : '<=',
  lt : '<',
  '~' : 'LIKE',
};

function convertType(type) {
  switch(type) {
    case 'string': return 'VARCHAR';
    default : return type.toUpperCase();
  }
}

function errorHandler(table) {
  return error => {
    if(error.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' && error.sqlMessage.includes('Access denied'))
      return Promise.reject({name: WRONG_VALUE, message: 'You are not allowed to access some data needed for your request.'});
    else if(error.code === 'ER_DUP_ENTRY') {
      const message = error.sqlMessage.replace(`I_${table}_`, '');
      const [dup, ids, key, tables] = message.split('\'');
      const [tableNames, property] = tables.split('_').map(name => name.replace('Id', ''));
      const [tableName, propertyName] = tableNames.split('.');
      //Array association
      if(table===propertyName+property) {
        const [propertyId, id] = ids.split('-');
        return Promise.reject({name: CONFLICT, message: `${dup}: Object ${id} received another occurence of ${property} ${propertyId}${key}${propertyName} whereas the association was expected to be unique.` });
      }
      //Normal table
      else {
        return Promise.reject({name: CONFLICT, message: `${dup}: Table ${tableName} received a second object with ${propertyName} ${ids} whereas it was expected to be unique.` });
      }
    }
    else if(error.code === 'ER_NO_DEFAULT_FOR_FIELD') return Promise.reject({name: REQUIRED, message: `${error.sqlMessage}, was not specified in the request, and is required in table ${table}.`});
    else {
      console.error(error);
      return Promise.reject({name: error.code, message: error.sqlMessage});
    }
  };
}

module.exports = ({database = 'simpleql', charset = 'utf8', create = false, host = 'localhost', connectionLimit = 100, ...parameters}) => {
  return Promise.resolve().then(() => {
    if(!create) return Promise.resolve();
    //Instantiate a connection to create the database
    const pool = mysql.createPool({...parameters, connectionLimit, host });
    const driver = new Driver(pool);
    //Destroy previous database if required
    return driver.query(`DROP DATABASE IF EXISTS ${database}`)
      .catch(err => {
        if(err.code === 'ECONNREFUSED') return Promise.reject(`Failed to connect to the database. Make sure that you have a MySQL database running on port ${err.port} of host ${err.address}. If you don't have a mysql database, you can install one with the following commands:
          sudo apt install mysql-server
          sudo mysql_secure_installation
          sudo systemctl start mysql
        `);
        else if(err.code === 'ER_NOT_SUPPORTED_AUTH_MODE') return Promise.reject(`ER_NOT_SUPPORTED_AUTH_MODE: Client does not support authentication protocol requested by server. You should try the following options:
          * downgrade your mysql server to 5.6.40,
          * use a non root user,
          * or run:
              ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password'`);
        else return Promise.reject(err);
      })
      //Create the database
      .then(() => driver.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET ${charset}`))
      .then(() => log('info', `Brand new ${database} database successfully created!`));
  })
    //Enter the database and returns the driver
    .then(() => {
      const pool = mysql.createPool({...parameters, database, connectionLimit, host });
      return new Driver(pool);
    });
};
