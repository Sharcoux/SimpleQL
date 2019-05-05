const colors = require('./colors');
const categories = {
  'database query' : 'bold',
  'database result' : 'default',
  'test title' : 'cyan',
  'test error title' : 'red',
  'test request' : 'default',
  'test response' : 'bold',
  'test error response' : 'bold',
  'resolution part' : 'default',
  'resolution part title' : 'magenta',
  'access warning' : 'yellow',
  'info' : 'cyan',
  'login' : 'cyan',
};

function log(category, ...data) {
  const c = categories[category];
  if(c===undefined) return;
  else if(c==='default') console.log(...data);
  else console.log(colors[c], ...data, colors.reset);
}

module.exports = log;