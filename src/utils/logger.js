/** Custom logger. Will be improved later */
const categories = {
  // 'database query' : 'bold',
  // 'database result' : 'default',
  'test title' : 'cyan',
  'test error title' : 'red',
  'test request' : 'default',
  'test response' : 'bold',
  'test error response' : 'bold',
  // 'resolution part' : 'default',
  // 'resolution part title' : 'magenta',
  // 'access warning' : 'yellow',
  'info' : 'cyan',
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

function log(category, ...data) {
  const c = categories[category];
  if(c===undefined) return;
  else if(c==='default') console.log(...data);
  else console.log(colorMap[c], ...data, colorMap.reset);
}

module.exports = log;