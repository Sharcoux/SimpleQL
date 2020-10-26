const errors = {
  REQUIRED : 'required',
  NOT_SETTABLE : 'notSettable',
  NOT_UNIQUE : 'notUnique',
  NOT_FOUND : 'notFound',
  BAD_REQUEST : 'badRequest',
  WRONG_PASSWORD : 'wrongPassword',
  UNAUTHORIZED : 'unauthorized',
  DATABASE_ERROR : 'databaseError',
  FORBIDDEN : 'forbidden',
  ACCESS_DENIED: 'accessDenied',
  WRONG_VALUE: 'wrongValue',
  CONFLICT: 'conflict',
};

/**
 * @typedef {Object} Error
 * @property {keyof errors} name The error name
 * @property {string} message The error message
 * @property {number} status The status code
 */

module.exports = errors;
