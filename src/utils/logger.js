// @ts-check

/** @typedef {'database query' | 'database result' | 'resolution part' | 'resolution part title' | 'access warning' | 'info' | 'error' | 'login' | 'warning' } LogCategory */

/** Custom logger. Will be improved later */
const categories = {
  // 'database query' : 'bold',
  // 'database result' : 'default',
  // 'resolution part' : 'default',
  // 'resolution part title' : 'magenta',
  // 'access warning' : 'yellow',
  'info' : 'cyan',
  'warning' : 'yellow',
  'error': 'red',
  // 'login' : 'cyan',
};

const colors = {
  0  : 'reset',
  1  : 'bold',
  2  : 'thin',
  3  : 'italic',
  4  : 'underline',
  30 : 'black',
  31 : 'red',
  32 : 'green',
  33 : 'yellow',
  34 : 'blue',
  35 : 'magenta',
  36 : 'cyan',
  37 : 'lightGray',
  90 : 'darkGray',
  91 : 'lightRed',
  92 : 'lightGreen',
  93 : 'lightYellow',
  94 : 'lightBlue',
  95 : 'lightMagenta',
  96 : 'lightCyan',
};

const colorMap = {};
Object.keys(colors).forEach(key => colorMap[colors[key]] = `\x1b[${key}m`);

/**
 * Log results
 * @param {LogCategory} category The category of the message going to be logged
 * @param  {...string} data The data to log
 */
function log(category, ...data) {
  const c = categories[category];
  if(c===undefined) return;
  else if(c==='default') console.log(...data);
  else console.log(colorMap[c], ...data, colorMap.reset);
}

module.exports = log;