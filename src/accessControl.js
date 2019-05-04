const { any, sequence, classifyData } = require('./utils');
const { DATABASE_ERROR } = require('./errors');

/** Rule that enables anyone */
function all() {
  return () => Promise.resolve();
}

/** No one is enabled by this rule */
function none() {
  return () => Promise.reject('None rule');
}

/** Product of provided rules */
function and(...rules) {
  return preParams => params => sequence(rules.map(rule => () => rule(preParams)(params)));
}

/** Union of provided rules */
function or(...rules) {
  return preParams => params => any(rules.map(rule => () => rule(preParams)(params)));
}

/** Rule that enables anyone that doesn't fulfill the provided rule */
function not(rule) {
  return preParams => params => new Promise((resolve, reject) => rule(preParams)(params).then(reject, resolve));
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
  if(!field || !(Object(field) instanceof String)) return Promise.reject('`is` rule expects its parameter to be a string matching a field or a table. Please refer to the documentation.');
  return () => ({authId, request, object, requestFlag}) => {
    if(requestFlag) {
      const target = getObjectInRequest(request, field);
      return target && target.reservedId === authId ? Promise.resolve() : Promise.reject(`is(${field}) rule: ${authId} is not ${field} of ${JSON.stringify(request)}.`);
    }
    if(field==='self') {
      return object.reservedId === authId ? Promise.resolve() : Promise.reject(`is(self) rule: ${authId} is not the id of ${JSON.stringify(object)}.`);
    }
    const target = getTargetObject(object, field);
    return target && target.reservedId === authId ? Promise.resolve() : Promise.reject(`is(${field}) rule: ${authId} is not ${field} of ${JSON.stringify(object)}.`);
  };
}

/** Enable only the users that are a member of the denoted field list. The field can be relative or absolute. */
function member(field) {
  if(!field || !(Object(field) instanceof String)) return Promise.reject('`member` rule expects its parameter to be a string matching a field or a table. Please refer to the documentation.');
  return ({tables, tableName}) => ({authId, object, request, requestFlag, query}) => {
    const isValid = array => {
      if(!(array instanceof Array)) return false;
      return array.map(elt => elt.reservedId).includes(authId);
    };
    return checkInTable({field, tables, tableName, authId, object, request, requestFlag, query, ruleName : 'member', isValid});
  };
}

/** Valid only if the field contains between amount and max elements. The field can be relative or absolute. */
function count(field, { amount, min, max} = {}) {
  if(!field || !(Object(field) instanceof String)) return Promise.reject('`count` rule expects its first parameter to be a string matching a field or a table. Please refer to the documentation.');
  if((amount===undefined && min===undefined && max===undefined) || [amount, min, max].find(e => e!==undefined && isNaN(e))) return Promise.reject('`count` rule expects its second parameter to be an object indicating the amount of elements allowed for this field.');
  if(amount!==undefined && (min!==undefined || max !==undefined)) return Promise.reject('You cannot provide both \'amount\' and \'min/max\' in the \'count\' rule');
  const isValid = elt => {
    let value = elt instanceof Array ? elt.length : Number.parseInt(elt, 10);
    if(amount) return value===amount;
    else if(min) {
      if(max) return value>=min && value<=max;
      else return value>=min;
    } else return value<=max;
  };
  return ({tables, tableName}) => ({authId, object, request, requestFlag, query}) => {
    return checkInTable({field, tables, tableName, authId, object, request, requestFlag, query, ruleName : 'count', isValid});
  };
}

function checkInTable({field, tables, tableName, authId, object, request, requestFlag, query, ruleName, isValid}) {
  if(requestFlag) {
    const obj = getObjectInRequest(request, field);
    if(!obj) return Promise.reject(`${ruleName}(${field}) rule: The field ${field} is required in requests ${JSON.stringify(request)} in table ${tableName}.`);
    if(!(obj instanceof Array)) return isValid([obj]) ? Promise.resolve() : Promise.reject(`${ruleName}(${field}) rule: The field ${field}.reservedId must be ${authId} in request ${JSON.stringify(request)} in table ${tableName}.`);
    return isValid(obj) ? Promise.resolve() : Promise.reject(`${ruleName}(${field}) rule: ${authId} could not be found in ${field} of ${JSON.stringify(request)} in ${tableName}.`);
    //We are looking inside the object result
  } else if(tables[tableName][field]) {
    return query({
      [tableName] : {
        reservedId : object.reservedId,
        get : [field],
      }
    }, { admin : true, readOnly : true }).then(({[tableName] : results}) => {
      if(results.find(result => !isValid(result[field]))) return Promise.reject(`${ruleName}(${field}) rule: ${authId} not ${field} of ${object.reservedId} in ${tableName}.`);
      return Promise.resolve();
    });
  } else {
    const target = getTargetObject(object, field);
    if(target) {
      if(!(target instanceof Array)) {
        return Promise.reject({
          name: DATABASE_ERROR,
          message: `You cannot use ${ruleName} rule on ${field} in ${tableName} as it is not an array.`,
        });
      }
      return isValid(target) ? Promise.resolve() : Promise.reject(`${ruleName}(${field}) rule`);
    }
    //We try to look into the whole table
    const [tName, property] = field.split('.');
    const table = tables[tName];
    if(!table) {
      return Promise.reject({
        name : DATABASE_ERROR,
        message : `The field ${field} was not found in the resulting object ${JSON.stringify(object)} in table ${tableName}, nor in the tables.`,
      });
    }
    const { objects } = classifyData(table);
    if(property && !objects.includes(property)) {
      return Promise.reject({
        name : DATABASE_ERROR,
        message : `The field ${property} was not found in the table ${tName} in the '${ruleName}' rule specified in table ${tableName}.`,
      });
    }
    const targetField = property || 'reservedId';
    if(table[targetField] instanceof Array) return Promise.reject({
      name : DATABASE_ERROR,
      message : `The field ${targetField} is an array in the table ${tName}. It should be an object to deal correctly with the ${ruleName} rule ${field}.`
    });
    return query({ [tName] : { get: [targetField]} }, {admin : true, readOnly : true }).then(results => {
      const data = results[tName].map(result => property ? result.property : result);
      return isValid(data) ? Promise.resolve() : Promise.reject(`${ruleName}(${field}) rule: ${authId} not ${targetField} of elements in ${tName}.`);
    });
  }
}

module.exports = {
  not,
  and,
  or,
  count,
  member,
  is,
  all,
  request,
  none,
};