function isPrimitive(value) {
  return value!==undefined && value!==Object(value);
}

function restrictContent(array1, array2) {
  return array1.filter(elt => array2.includes(elt));
}

module.exports = {
  isPrimitive,
  restrictContent,
};