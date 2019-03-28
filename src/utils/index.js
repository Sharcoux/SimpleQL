function isPrimitive(value) {
  return value!==undefined && value!==Object(value);
}

/** Returns the intersection between array1 and array2 */
function restrictContent(array1, array2) {
  return array1.filter(elt => array2.includes(elt));
}

function stringify(data) {
  if(data instanceof Function) return data + '';
  else if(data instanceof Array) return '['+data.map(stringify).join(', ')+']';
  else if(data instanceof Object) return JSON.stringify(Object.keys(data).reduce((acc,key) => {acc[key]=stringify(data[key]);return acc;},{}), undefined, 4);
  else return data+'';
}


/** Classify the object props into 5 arrays:
 * - empty : keys whose value is present but undefined or null
 * - reserved : reserved keys having special meaning
 * - primitives : keys whose value is a primitive
 * - arrays : keys whose value is an array
 * - objects : keys whose value is an object which is not an array
 */
function classifyData(object) {
  const keys = Object.keys(object);
  const {reserved, constraints, empty} = keys.reduce((acc, key) => {
    //This is the only reserved key denoting a valid constraint
    if(key==='reservedId') {
      acc.constraints.push(key);
    } else if(reservedKeys.includes(key)) {
      acc.reserved.push(key);
    } else if(object[key]!==undefined || object[key]!==null) {
      acc.constraints.push(key);
    } else {
      acc.empty.push(key);
    }
    return acc;
  }, {reserved: [], constraints: [], empty: []});
  const {primitives, objects, arrays} = constraints.reduce(
    (acc,key) => {
      const value = object[key];
      const belongs = isPrimitive(value) ? 'primitives' : value instanceof Array ? 'arrays'
        : value.type ? 'primitives' : 'objects';
      acc[belongs].push(key);
      return acc;
    },
    {primitives: [], objects: [], arrays: []}
  );
  return {
    empty, reserved, primitives, objects, arrays
  };
}

/** Classify request fields of a request inside a table into 4 categories
 * - request : the request restricted to only the fields defined in the tables
 * - search : keys whose value is present but undefined
 * - primitives : keys which are a column of the table
 * - objects : keys that reference an object in another table (key+'Id' is a column inside the table) 
 * - arrays : keys that reference a list of objects in another table (through an association table named key+tableName)
 * We also update the request if it was "*"
 */
function classifyRequestData(request, table) {
  const tableData = classifyData(table);

  //We allow using '*' to mean all columns
  if(request.get==='*') request.get = [...tableData.primitives];
  //We restrict the request to only the field declared in the table
  //fields that we are trying to get info about
  const search = restrictContent(request.get || [], tableData.primitives);
  //constraints for the research
  const [primitives, objects, arrays] = ['primitives', 'objects', 'arrays'].map(key => restrictContent(tableData[key], Object.keys(request)));
  return { request, search, primitives, objects, arrays };
}

const reservedKeys = ['reservedId', 'set', 'get', 'delete', 'create', 'add', 'remove', 'not', 'like', 'or', 'limit', 'offset', 'tableName', 'foreignKeys', 'type', 'parent'];
const operators = ['not', 'like', 'gt', 'ge', 'lt', 'le', '<', '>', '<=', '>=', '~', '!'];

module.exports = {
  isPrimitive,
  restrictContent,
  stringify,
  classifyData,
  classifyRequestData,
  reservedKeys,
  operators,
};