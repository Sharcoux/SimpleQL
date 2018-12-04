// import { restrictContent } from '.utils';
// import { classifyRequestData } from './database';
const { DATABASE_ERROR } = require('./errors');

/** Rule that enables anyone */
function all() {
  return () => true;
}

/** Product of provided rules */
function and(...rules) {
  return () => rules.every(rule => rule(arguments));
}

/** Union of provided rules */
function or(...rules) {
  return () => rules.some(rule => rule(arguments));
}

/** Rule that enables anyone that doesn't fulfill the provided rule */
function not(rule) {
  return () => !rule(arguments);
}

/** Look for a field like 'User.name' inside the local object. If not found, look into the global object */
function getTargetObject(globalObject, localObject, field) {
  const fields = field.split('.');
  function get(object, fields, local) {
    if(!fields.length) return {found: false, local, value: undefined};
    if(fields.length===1) return {found: object[fields[0]]!==undefined, local, value: object[fields[0]]};
    const f = fields.shift();
    if(Object.keys(object).includes(f)) return get(object[f], fields, local);
    return {found: false, local, value: undefined};
  }
  const localResult = get(localObject, fields, true);
  if(localResult) return localResult;
  return get(globalObject, fields, false);
}

/** Enable only the users whose id matches the denoted field value (relative or absolute) */
function is(field) {
  return ({authId, request, object, tables, table, requestFlag, tableRequest}) => {
    if(requestFlag) {
      const target = getTargetObject(request, tableRequest, field).value;
      return target && target.reservedId === authId;
    }
    if(field==='self') {
      return object.reservedId === authId;
    }
    const target = getTargetObject(tables, table, field).value;
    return target && target.reservedId === authId;
  };
}

/** If this rule is used, the inner rules will now apply to the request instead of the database */
function request(rule) {
  return data => rule({...data, requestFlag: true});
}

/** No one is enabled by this rule, except if the privateKey is provided as a authId */
function none() {
  return ({authId, privateKey}) => (authId===privateKey);
}

/** Enable only the users that are a member of the denoted field list. The field can be relative or absolute. */
function member(field) {
  return ({authId, object, tables, tableName, request, requestFlag, tableRequest, driver}) => {
    if(requestFlag) {
      const members = getTargetObject(request, tableRequest, field).value;
      return members.includes(authId);
    } else {
      const { found, local, value } = getTargetObject(request, tableRequest, field);
      if(!found) return Promise.reject({
        type: DATABASE_ERROR,
        message: `The field ${field} was not found in the database.`,
      });
      if(local) {
        //We are looking into a list inside the current table
        if(!(value instanceof Array)) {
          return Promise.reject({
            type: DATABASE_ERROR,
            message: `You cannot use member rule on ${field} in ${tableName} as it is not an array.`,
          });
        }
        return driver.get({
          table: tableName,
          search : ['reservedId'],
          where : {
            [tableName+'Id'] : object.reservedId,
            [field+'Id'] : authId,
          },
        }).then(results => results.length>0);
      } else {
        const fields = field.split('.');
        if(fields.length===1) {
          //We are looking into the whole table
          return driver.get({
            table: field,
            search : ['reservedId'],
            where : {
              reservedId : authId,
            },
          }).then(results => results.length>0);
        } else {
          //We are looking for a specific field into another table
          if(!(value instanceof Array)) {
            return Promise.reject({
              type: DATABASE_ERROR,
              message: `You cannot use member rule on ${fields[1]} in ${fields[0]} as it is not an array.`,
            });
          }
          return driver.get({
            table: fields[0],
            search : ['reservedId'],
            where : {
              [fields[1]+'Id'] : object.reservedId,
              [tables[fields[0]]+'Id'] : authId,
            },
          }).then(results => results.length>0);
        }
      }
    }
  };
}

// function readAccessControl(tables, rules) {
//   return (req, res, next) => {
    
//   }
// }
// function writeAccessControl(tables, rules) {
//   return (authId, request) => {
//     function checkRequest(req, table) {
//       const { primitives, search, objects, arrays } = classifyRequestData(req, table);
//       const { set, create } = req;
//       if(set) {
  
//       }
//       if(create) {
//         const rule = rules[table.tableName] && rules[table.tableName].create;
//         if(rule && !rule(authId, )
//       }
//       return Promise.all(objects.map(key => checkRequest(req[key])));
//     }
//     return Promise.all(Object.keys(request).map(key => {
//       if(!tables[key]) {
//         console.error(`${key} table doesn't exist`);
//         return Promise.resolve();
//       } else {
//         return checkRequest(request[key], tables[key]);
//       }
//     });
//   }
// }

module.exports = {
  not,
  and,
  or,
  member,
  is,
  all,
  request,
  none,
};