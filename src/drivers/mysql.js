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
        resolve(results);
      });
    });
  }
  destroy() {
    this.connection.end(console.error);
  }
  startTransaction() {
    //We need to ensure that we are using the same connection during the whole transaction
    if(this.inTransaction) return Promise.reject('You already started a transaction. Call `commit()` or `rollback()` to terminate it.');
    return new Promise((resolve, reject) => {
      this.pool.getConnection((err, connection) => {
        if(err) reject(err);
        this.connection = connection;
        this.inTransaction = true;
        return this.query('START TRANSACTION').then(resolve).catch(reject);
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
  get({table, search, where, offset, limit}) {
    if(!search.length) return Promise.resolve({});
    let query = this._createQuery(`SELECT ${search.map(s => ei(s)).join(', ')} FROM ${ei(table)}`, where, table);
    if(offset) query += ` OFFSET ${es(parseInt(offset, 10))}`;
    if(limit) query += ` LIMIT ${es(parseInt(limit, 10))}`;
    return this.query(query).then(results => {
      log('database result', JSON.stringify(results));
      return results instanceof Array ? results : [results];
    });
  }
  delete({table, where}) {
    const query = this._createQuery(`DELETE FROM ${ei(table)}`, where, table);
    return this.query(query);
  }
  create({table, elements}) {
    if(!elements) return Promise.resolve();
    let list = elements instanceof Array ? elements : [elements];
    //For each property provided as an array, we duplicate the elements to be created. {a : [1, 2]} becomes [{a: 1}, {a : 2}].
    [...list].forEach(elt => {
      Object.keys(elt).forEach(key => {
        const val = elt[key];
        if(val instanceof Array) {
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
      return this.query(query).then(results => results instanceof Array ? results.map(result => result.insertId) : results.insertId);
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
    const setQuery = Object.keys(values).map(key => {
      const value = values[key];
      return `${ei(key)}=${this._escapeValue(table, key, value)}`;
    }).join(', ');
    const query = this._createQuery(`UPDATE ${ei(table)} SET ${setQuery}`, where, table);
    return this.query(query);
  }
  createTable({table = '', data = {}, index = []}) {
    const columnsKeys = Object.keys(data).filter(key => key!=='index');
    const columns = columnsKeys.map(name => {
      const { type, length, unsigned, notNull, defaultValue, autoIncrement } = data[name];
      //We record binary columns to not escape their values during INSERT or UPDATE
      if(type==='binary' || type==='varbinary') this.binaries.push(`${table}.${name}`);
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
      if(elt.column instanceof Array) {
        if(elt.length && (!(elt.length instanceof Array) || elt.length.length!==elt.column.length)) throw new Error(`length in index definition of table ${table} must be an array matching the column array.`);
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
    )`);
  }
  createForeignKeys(foreignKeys = {}) {
    return sequence(Object.keys(foreignKeys).map(tableName => () => {
      const keys = Object.keys(foreignKeys[tableName]);
      const query = keys.map(key => `ADD CONSTRAINT FK_${tableName}_${key} FOREIGN KEY (${key}) REFERENCES ${foreignKeys[tableName][key]}(reservedId) ON DELETE CASCADE ON UPDATE CASCADE`).join(',\n       ');
      return this.query(`
        ALTER TABLE ${tableName}
        ${query}
      `);
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
        if(value instanceof Array) return '('+value.map(v => writeCondition(v, operator)).join(' OR ')+')';
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

module.exports = ({database = 'simpleql', charset = 'utf8', create = false, host = 'localhost', connectionLimit = 100, ...parameters}) => {
  return Promise.resolve().then(() => {
    if(!create) return Promise.resolve();
    //Instantiate a connection to create the database
    const pool = mysql.createPool({...parameters, connectionLimit, host });
    const driver = new Driver(pool);
    //Destroy previous database if required
    return driver.query(`DROP DATABASE IF EXISTS ${database}`)
      .catch(err => {
        if(err.code === 'ECONNREFUSED') return Promise.reject(`Failed to connect to the database. Make sure that you have a MySQL database running on port ${err.port} of host ${err.address}.`);
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
