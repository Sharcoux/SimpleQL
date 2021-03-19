// @ts-check
const { getOptionalDep } = require('.')

const JSZip = getOptionalDep('jszip', 'File Storage Plugin')

/**
 * Generate a base64 encoded zip file from a list of pathnames and contents
 * @param {{ name: string; content: string}[]} files The list of name and content as base64 of all files to include in the zip
 * @returns {Promise<string>} the base64 encoded zip content
 */
async function zipFiles (files = [{ content: 'content', name: 'path to file' }]) {
  const zip = new JSZip()
  await Promise.all(files.map(async ({ name, content }) => {
    zip.file(name, content)
  }))
  const base64 = await new Promise((resolve) => {
    const chunks = []
    const nodeStream = zip.generateNodeStream({ streamFiles: true })
    nodeStream.on('data', function (chunk) {
      chunks.push(chunk)
    })
    nodeStream.on('end', function () {
      const result = Buffer.concat(chunks)
      resolve(result.toString('base64'))
    })
  })
  return base64
}

/**
 * Generate a list of name and base64 encoded content from a base64 encoded zip file
 * @param {string} content base64 zip content
 * @returns {Promise<{ name: string; content: string }[]>} The list of name and content as base64 of all files in the zip
 */
async function unzipFiles (content) {
  const zip = new JSZip()
  await zip.loadAsync(content, { base64: true })
  // Keep only the files that aren't directories
  const files = Object.keys(zip.files).filter(file => !zip.files[file].dir)
  const filesContent = await Promise.all(files.map(file => zip.file(file).async('base64')))
  return files.map((file, i) => ({ name: file, content: filesContent[i] }))
}

module.exports = {
  zipFiles,
  unzipFiles
}
