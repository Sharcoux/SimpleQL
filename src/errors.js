const errors = {
  REQUIRED: 'REQUIRED',
  NOT_SETTABLE: 'NOT_SETTABLE',
  NOT_UNIQUE: 'NOT_UNIQUE',
  NOT_FOUND: 'NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  UNAUTHORIZED: 'UNAUTHORIZED',
  DATABASE_ERROR: 'DATABASE_ERROR',
  FORBIDDEN: 'forbFORBIDDENidden',
  ACCESS_DENIED: 'ACCESS_DENIED',
  WRONG_VALUE: 'WRONG_VALUE',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS'
}

/**
 * @typedef {Object} Error
 * @property {keyof errors} name The error name
 * @property {string} message The error message
 * @property {number} status The status code
 */

module.exports = errors
