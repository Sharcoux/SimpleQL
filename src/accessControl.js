const { any, classifyData } = require('./utils');
const { DATABASE_ERROR } = require('./errors');

/** Rule that enables anyone */
function all() {
  return () => Promise.resolve();
}

/** No one is enabled by this rule, except if the privateKey is provided as a authId */
function none({privateKey}) {
  return ({authId}) => authId===privateKey ? Promise.resolve() : Promise.reject('None rule');
}

/** Product of provided rules */
function and(...rules) {
  return preParams => params => Promise.all(rules.map(rule => rule(preParams)(params)));
}

/** Union of provided rules */
function or(...rules) {
  return preParams => params => any(rules.map(rule => rule(preParams)(params)));
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
      return target && target.reservedId === authId ? Promise.resolve() : Promise.reject(`is(${field}) rule`);
    }
    if(field==='self') {
      return object.reservedId === authId ? Promise.resolve() : Promise.reject('is(self) rule');
    }
    const target = getTargetObject(object, field);
    return target && target.reservedId === authId ? Promise.resolve() : Promise.reject(`is(${field}) rule`);
  };
}

/** Enable only the users that are a member of the denoted field list. The field can be relative or absolute. */
function member(field) {
  if(!field || !(Object(field) instanceof String)) return Promise.reject('`member` rule expects its parameter to be a string matching a field or a table. Please refer to the documentation.');
  return ({tables, tableName}) => ({authId, object, request, requestFlag, query}) => {
    if(requestFlag) {
      const members = getObjectInRequest(request, field);
      return members.map(member => member.reservedId).includes(authId) ? Promise.resolve() : Promise.reject(`member(${field}) rule`);
    } else {
      //We are looking inside the object result
      if(tables[tableName][field]) {
        return query({
          [tableName] : {
            reservedId : object.reservedId,
            [field] : { get : ['reservedId']}
          }
        }, { admin : true, readOnly : true }).then(({[tableName] : results}) => {
          if(!results.find(result => result.reservedId === authId)) return Promise.reject(`member(${field}) rule`);
          return Promise.resolve();
        });
      }
      const target = getTargetObject(object, field);
      if(target) {
        if(!(target instanceof Array)) {
          return Promise.reject({
            name: DATABASE_ERROR,
            message: `You cannot use member rule on ${field} in ${tableName} as it is not an array.`,
          });
        }
        return target.map(element => element.reservedId).includes(authId) ? Promise.resolve() : Promise.reject(`member(${field}) rule`);
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
          message : `The field ${property} was not found in the table ${tName} in the 'member' rule specified in table ${tableName}.`,
        });
      }
      const targetField = property || 'reservedId';
      return query({
        [table] : { get: [targetField]},
      }).then(results => {
        results.map(result => property ? result.property.reservedId : result.reservedId);
      })
        .then(results => results.includes(authId ? Promise.resolve() : Promise.reject(`member(${field}) rule`)));
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