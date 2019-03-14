function isPrimitive(value) {
  return value!==undefined && value!==Object(value);
}

/** Returns the intersection between array1 and array2 */
function restrictContent(array1, array2) {
  return array1.filter(elt => array2.includes(elt));
}

module.exports = {
  isPrimitive,
  restrictContent,
};