/**
 * Utility function for reading Godot's newline terminated strings
 * @param {Buffer} buffer
 * @param {number} offset
 * @returns {{text: string, off: number}}
 */
function readLine(buffer,offset) {
  let endPos = buffer.byteLength;
  for (let i = offset; i < buffer.byteLength; i++) {
    if (buffer[i] === 0x0A) {
      endPos = i;
      break;
    }
  }

  const value = buffer.slice(offset, endPos);
  return {text: value.toString("utf-8"), off: endPos + 1};
}
exports.readLine = readLine

/**
 * Gets the format of an audio file buffer.  
 * Only handles audio formats that SS+ can use.
 * @param {Buffer} buffer
 * @returns {"unknown"|"ogg"|"mp3"} type
 */
function getAudioType(buffer) {
  if (buffer.byteLength < 4) { return "unknown" }

  if (
    // OGG
    buffer.slice(0,4).equals(  Buffer.from([0x4F,0x67,0x67,0x53])  )
  ) { return "ogg" }
  else if (
    // MP3
    buffer.slice(0,2).equals(  Buffer.from([0xFF,0xFB])  ) ||
    buffer.slice(0,2).equals(  Buffer.from([0xFF,0xF3])  ) ||
    buffer.slice(0,2).equals(  Buffer.from([0xFF,0xFA])  ) ||
    buffer.slice(0,2).equals(  Buffer.from([0xFF,0xF2])  ) ||
    buffer.slice(0,3).equals(  Buffer.from([0x49,0x44,0x33])  )
  ) { return "mp3" }
  else { return "unknown" }
}
exports.getAudioType = getAudioType