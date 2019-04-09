const { restrictContent, classifyRequestData } = require('./utils');
const { DATABASE_ERROR } = require('./errors');

/** Rule that enables anyone */
function all() {
  return () => true;
}

/** No one is enabled by this rule, except if the privateKey is provided as a authId */
function none({privateKey}) {
  return ({authId}) => authId===privateKey;
}

/** Product of provided rules */
function and(...rules) {
  return preParams => params => rules.every(rule => rule(preParams)(params));
}

/** Union of provided rules */
function or(...rules) {
  return preParams => params => rules.some(rule => rule(preParams)(params));
}

/** Rule that enables anyone that doesn't fulfill the provided rule */
function not(rule) {
  return preParams => params => !rule(preParams)(params);
}

/** If this rule is used, the inner rules will now apply to the request instead of the database */
function request(rule) {
  return preParams => params => rule(preParams)({...params, requestFlag: true});
}

/** Look for an object denoted by `field` pathName into the request.
 * field can use `parent` or `..` to look into the parent request.
 **/
function getObjectInRequest(request, field) {
  if(!field) return request;
  if(!request) return undefined;
  const fields = field.split('.');
  const first = fields.shift();
  if(first==='parent' || first==='..') return getObjectInRequest(request.parent, fields.join('.'));
  return getObjectInRequest(request[first], fields.join('.'));
}

/** Look for a children property into the object. Can look deeper into the object by using `.` to separate properties. */
function getTargetObject(object, field) {
  if(!field) return object;
  if(!object) return undefined;
  const fields = field.split('.');
  const first = fields.shift();
  return getTargetObject(object[first], fields.join('.'));
}

/** Enable only the users whose id matches the denoted field value (relative or absolute) */
function is(field) {
  return ({tables, table}) => ({authId, request, object, requestFlag}) => {
    if(requestFlag) {
      const target = getObjectInRequest(request, field);
      return target && target.reservedId === authId;
    }
    if(field==='self') {
      return object.reservedId === authId;
    }
    const target = getTargetObject(object, field);
    return target && target.reservedId === authId;
  };
}

/** Enable only the users that are a member of the denoted field list. The field can be relative or absolute. */
function member(field) {
  return ({tables, table, query}) => ({authId, object, tables, tableName, request, requestFlag, tableRequest, driver}) => {
    if(requestFlag) {
      const members = getObjectInRequest(request, field);
      return members.map(member => member.reservedId).includes(authId);
    } else {
      const target = getTargetObject(object, field);
        if(!(value instanceof Array)) {
          throw {
            type: DATABASE_ERROR,
            message: `You cannot use member rule on ${field} in ${tableName} as it is not an array.`,
          };
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
  };
}

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