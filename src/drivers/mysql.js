const mysql = require('mysql');

//Shortcuts for escaping
/* Escaping values */
const es = mysql.escape;
/* Escaping identifiers */
const ei = mysql.escapeId;

//TODO : format requests results
class Driver {
  constructor(connection) {
    this.connection = connection;
    this.query = this.query.bind(this);
    this.get = this.get.bind(this);
    this.update = this.update.bind(this);
    this.create = this.create.bind(this);
    this.delete = this.delete.bind(this);
    this.createTable = this.createTable.bind(this);
  }
  query(query) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(`timeout for requet ${query}`), 3000);
      console.log(`Executing ${query}`);
      this.connection.query(query+';', function (error, results, fields) {
        // console.log(results, fields);
        clearTimeout(timeout);
        if (error) reject(error);
        resolve(results);
      });
    }).catch(err => {
      console.error(err);
      return Promise.reject(err);
    });
  }
  destroy() {
    this.connection.end(console.error);
  }
  startTransaction() {
    return this.query('START TRANSACTION');
  }
  commit() {
    return this.query('COMMIT');
  }
  rollback() {
    return this.query('ROLLBACK');
  }
  get({table, search, where, offset, limit}) {
    if(!search.length) return Promise.resolve({});
    let query = createQuery(`SELECT ${search.map(s => es(s)).join(', ')} FROM ${ei(table)}`, where);
    if(offset) query += ` OFFSET ${es(parseInt(offset, 10))}`;
    if(limit) query += ` LIMIT ${es(parseInt(limit, 10))}`;
    return this.query(query);
  }
  delete({table, where}) {
    const query = createQuery(`DELETE FROM ${ei(table)}`, where);
    return this.query(query);
  }
  create({table, elements}) {
    if(!elements) return Promise.resolve();
    const list = !(elements instanceof Array) ? [elements] : elements;
    return Promise.all(list.map(element => {
      const query = `INSERT INTO ${ei(table)} (
        ${Object.keys(element).map(k => es(k)).join(', ')}
      ) VALUES (
        ${Object.values(element).map(v => es(v)).join(', ')}
      )`;
      return this.query(query);
    }));
  }
  update({table, values, where}) {
    const setQuery = Object.keys(values).map(key => {
      const value = values[key];
      return `${es(key)}=${value===null ? 'NULL' : es(value)}`;
    }).join(', ');
    const query = createQuery(`UPDATE TABLE ${ei(table)} SET ${setQuery}`, where);
    return this.query(query);
  }
  createTable({table = '', data = {}, index = {}}) {
    const columnsKeys = Object.keys(data).filter(key => key!=='index');
    const columns = columnsKeys.map(name => {
      if(Object(data[name]) instanceof String) {
        const [type, length] = data[name].split('/');
        data[name] = { type, length };
      }
      const { type, length, unsigned, nullable, defaultValue, autoIncrement } = data[name];
      let query = `, ${name} ${convertType(type)}`;
      if(length) query += `(${length})`;
      if(unsigned) query += ' UNSIGNED';
      if(!nullable) query += ' NOT NULL';
      if(defaultValue) query += ` DEFAULT ${defaultValue === null ? 'NULL' : defaultValue}`;
      if(autoIncrement) query += ' AUTO_INCREMENT';
      return query;
    });
    //The length is required
    const missingLength = columnsKeys.find(name => !data[name].length);
    if(missingLength && lengthRequired.includes(data[missingLength].type)) return Promise.reject(`You need to specify the column length for key ${missingLength} in table ${table}. You provided : ${JSON.stringify(data[missingLength])}.`);
    //Create indexes
    const indexes = Object.keys(index).map(key => {
      const details = (index[key] || '').split('/');
      const length = details.find(d => !isNaN(d));
      const status = details.find(isNaN);
      const writeStatus = status ? status.toUpperCase()+' ' : '';
      const writeLength = length ? '(' + length + ')' : '';
      const indexValues = [undefined, 'unique', 'fulltext', 'spatial'];
      if(!indexValues.includes(status)) throw new Error(`You specified ${status} as index value for key ${key} in table ${table} which is not a recognized value. Recognized values are ${JSON.stringify(indexValues)}`);
      return `, ${writeStatus}INDEX I_${table}_${key} (${key}${writeLength})`;
    });
    //Create the table
    return this.query(`CREATE TABLE IF NOT EXISTS ${table} (
        reservedId INT UNSIGNED NOT NULL AUTO_INCREMENT
      ${columns.join('\n      ')}
      ${indexes.join('\n      ')}
      , CONSTRAINT PK_${table} PRIMARY KEY (reservedId)
    )`);
  }
  createForeignKeys(foreignKeys = {}) {
    console.log(foreignKeys);
    return Promise.all(Object.keys(foreignKeys).map(tableName => {
      const keys = Object.keys(foreignKeys[tableName]);
      const query = keys.map(key => `ADD CONSTRAINT FK_${tableName}_${key} FOREIGN KEY (${key}) REFERENCES ${foreignKeys[tableName][key]}(reservedId) ON DELETE CASCADE ON UPDATE CASCADE`).join(',\n       ');
      return this.query(`
        ALTER TABLE ${tableName}
        ${query}
      `);
    }));
  }
}

const operators = ['not', 'like', 'gt', 'ge', 'lt', 'le'];
function createQuery(base, where) {
  if(!where || !Object.keys(where).length) return base;
  return `${base} WHERE ${convertIntoCondition(where)}`;
}

function convertIntoCondition(conditions, operator = '=') {
  function writeCondition(key, value) {
    if(operators.includes(key)) return convertIntoCondition(conditions[key], key);
    switch(operator) {
      case 'ge':
      case 'gt':
      case 'le':
      case 'lt':
      case 'like':
        return `${es(key)} ${operator.toUpperCase()} ${es(value)}`;
      case 'not':
        return value===null ? `${es(key)} IS NOT NULL` : `${es(key)}!=${es(value)}`;
      default:
        return value===null ? `${es(key)} IS NULL` : `${es(key)}=${es(value)}`;
    }
  }
  return Object.keys(conditions).map(key => {
    const value = conditions[key];
    if(value instanceof Array) return value.map(v => writeCondition(key, v)).join(' AND ');
    return writeCondition(key, value);
  }).join(' AND ');
}

function convertType(type) {
  switch(type) {
    case 'string': return 'VARCHAR';
    default : return type.toUpperCase();
  }
}

const lengthRequired = ['string'];

module.exports = ({database = 'simpleql', charset = 'utf8', create = false, connectionLimit = 100, ...parameters}) => {
  return Promise.resolve().then(() => {
    if(create) {
      //Create an initial connection and driver to create the database
      const connection = mysql.createConnection({...parameters, database});
      return new Promise((resolve, reject) => {
        connection.connect(function(err) {
          if(err) reject(err);
          else resolve(new Driver(connection));
        });
      }).then(driver =>
        //Destroy previous database if required
        driver.query(`DROP DATABASE IF EXISTS ${database}`)
          //Create the database
          .then(() => driver.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET ${charset}`))
          //Destroy single connection
          .then(() => connection.destroy())
          .then(() => console.log('\x1b[32m%s\x1b[0m', `Brand new ${database} database successfully created!`))
      );
    }
  })
    //Create connection with pool
    .then(() => mysql.createPool({...parameters, database, connectionLimit}))
    //Create the driver with the new connection
    .then(pool => new Driver(pool));
};
