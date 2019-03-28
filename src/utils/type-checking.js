const { stringify } = require('./');

function checkType(model, data) {
  if(!model) return;
  if(data===undefined) throw generateError(model, data, '');
  else if(Object(data) instanceof String) {
    if(!'string'.match(new RegExp(model))) throw generateError(formatModel(model), stringify(data), '');
    return;
  } else if(data instanceof Function) {
    if(model!=='function') throw generateError(formatModel(model), data);
  } else if(data!==null && data instanceof Object) {
    if(!(model instanceof Object)) throw generateError(formatModel(model), stringify(data) + '\n', '');
    const keys = Object.keys(model);
    keys.forEach(key => {
      if(model.required && model.required.includes(key) && (data[key]===undefined || data[key]===null)) throw generateError(model[key]+'(required)', undefined, key);
      if(!(model.required || []).includes(key) && (data[key]===undefined || data[key]===null)) return;
      try {
        checkType(model[key], data[key]);
      } catch(err) {
        const {expected, received, path} = err;
        throw generateError(expected, received, key+'.'+path);
      }
    });
    const strict = model.strict;
    const unknownKey = Object.keys(data).find(key => !keys.includes(key));
    if(unknownKey && strict) throw generateError('nothing', data[unknownKey], unknownKey);
  } else {
    if(!(Object(model) instanceof String)) throw generateError(formatModel(model), stringify(data), '');
    if((getType(data)).match(new RegExp(model))) return;
    throw generateError(model, data, '');
  }
}

function getType(data) {
  const type = typeof data;
  switch(type) {
    case 'number': {
      if(Number.isInteger(data)) return 'integer';
      return 'float';
    }
    default:
      return type;
  }
}

function generateError(expected, received, path) {
  return {
    expected, received, path
  };
}

function check(model, data) {
  try {
    checkType(model, data);
  } catch(err) {
    const { expected, received, path } = err;
    if(expected || received) throw new Error(`We expected ${stringify(expected)} but we received ${stringify(received)}${path && ` for ${path}`} in ${stringify(data)}`);
    else throw err;
  }
}

/** format a model into human readable json object */
function formatModel(model) {
  if(model instanceof Object) {
    const required = model.required || [];
    const strict = model.strict;
    const formatted = Object.keys(model).reduce((acc, key) => {
      if(['required', 'strict'].includes(key)) return acc;
      acc[key] = formatModel(model[key]) + (required.includes(key) ? ' (required)' : '');
      return acc;
    }, {});
    return stringify(formatted) + (strict ? ' (strict)' : '') + '\n';
  }
  else {
    return model.toString();
  }
}

module.exports = check;