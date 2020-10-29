// @ts-check

/** Custom type checking system to detect any error coming from a user and provide the most possible accurate error message */
const { stringify, toType } = require('./')

/**
 * Check that the data matches the model
 * @param {import('./types').Model} model
 * @param {any} data
 * @throws Throw an error if the data doesn't match the model
 **/
function checkType (model, data) {
  if (!model) return
  if (data === undefined) throw generateError(model, data, '')
  // If the data is a string, we ensure that the model accepts string as result
  else if (Object(data) instanceof String) {
    if (model === 'string' || model === '*') return
    throw generateError(formatModel(model), stringify(data), '')
    // If the data is a function we ensure that the model is 'function'
  } else if (data instanceof Function) {
    if (model !== 'function' && model !== '*') throw generateError(formatModel(model), data, '')
    // If the data is an array, we ensure that the model is an array containg the type of the data's content
  } else if (Array.isArray(data)) {
    if (!Array.isArray(model)) throw generateError(formatModel(model), data, '')
    let index = 0
    try {
      data.forEach((d, i) => { index = i; checkType(model[0], d) })
    } catch (err) {
      const { expected, received, path } = err
      throw generateError(expected, received, '[' + index + ']' + (path ? '.' + path : ''))
    }
    // If the data id an object we ensure that the model is an object matching the data
  } else if (data !== null && data instanceof Object) {
    if (typeof model !== 'object') throw generateError(formatModel(model), stringify(data) + '\n', '')
    const keys = Object.keys(model)
    keys.forEach(key => {
      if (['required', 'strict'].includes(key)) return
      if (model.required && model.required.includes(key) && (data[key] === undefined || data[key] === null)) throw generateError(/** @type {import('./types').TypeValue} **/(model[key]), undefined, key, true)
      if (!(model.required || []).includes(key) && (data[key] === undefined || data[key] === null)) return
      try {
        checkType(/** @type {import('./types').TypeValue} **/(model[key]), data[key])
      } catch (err) {
        const { expected, received, path } = err
        throw generateError(expected, received, key + '.' + path)
      }
    })
    /** @type {boolean} **/
    const strict = model.strict
    const unknownKey = Object.keys(data).find(key => !keys.includes(key))
    if (unknownKey && strict) throw generateError('nothing', data[unknownKey], unknownKey)
    // If the data is a primitive
  } else {
    // If the model is not a string, there is an issue
    if (!(Object(model) instanceof String)) throw generateError(formatModel(model), stringify(data), '')
    // If the model accepts the data type, it's allright
    if (model === getType(data) || model === '*') return
    // We refuse this data
    throw generateError(model, data, '')
  }
}

/**
 * Retrieve the type of the provided value
 * @param {any} data The value to analyse
 * @returns {import('./types').TypeValue}
 */
function getType (data) {
  const type = toType(data)
  switch (type) {
    case 'number': {
      if (Number.isInteger(data)) return 'integer'
      return 'float'
    }
    default:
      return type
  }
}

/**
 * Generates an error object
 * @param {import('./types').Model | 'nothing'} expected The expected type
 * @param {any} received The type we actually received
 * @param {string} path The path in the object to reach the value
 * @param {boolean=} required Was the value required
 * @returns {{ expected: import('./types').Model | 'nothing'; received: any; path: string; required?: boolean }}
 */
function generateError (expected, received, path, required) {
  return {
    expected, received, path, required
  }
}

/**
 * Check
 * @param {import('./types').Model} model
 * @param {any} data
 * @throws Throw an error if the data doesn't match the model
 */
function check (model, data) {
  try {
    checkType(model, data)
  } catch (err) {
    const { expected, received, path, required } = err
    if (expected || received) throw new Error(`We expected ${stringify(expected)}${required ? '(required)' : ''} but we received ${stringify(received)}${path && ` for ${path}`} in ${stringify(data)}`)
    else throw err
  }
}

/** format a model into human readable json object
 * @param {import('./types').Model} model The model to analyse
*/
function formatModel (model) {
  if (Array.isArray(model)) {
    return `[${formatModel(model[0])}]`
  } else if (typeof model === 'object') {
    const required = model.required || []
    const strict = model.strict
    const formatted = Object.keys(model).reduce((acc, key) => {
      if (['required', 'strict'].includes(key)) return acc
      acc[key] = formatModel(/** @type {import('./types').TypeValue} **/(model[key])) + (required.includes(key) ? ' (required)' : '')
      return acc
    }, /** @type {import('./types').Model} **/({}))
    return stringify(formatted) + (strict ? ' (strict)' : '') + '\n'
  } else {
    return model.toString()
  }
}

module.exports = check
