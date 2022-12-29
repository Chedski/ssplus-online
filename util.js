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

  const value = buffer.subarray(offset, endPos);
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
    buffer.subarray(0,4).equals(  Buffer.from([0x4F,0x67,0x67,0x53])  )
  ) { return "ogg" }
  else if (
    // MP3
    buffer.subarray(0,2).equals(  Buffer.from([0xFF,0xFB])  ) ||
    buffer.subarray(0,2).equals(  Buffer.from([0xFF,0xF3])  ) ||
    buffer.subarray(0,2).equals(  Buffer.from([0xFF,0xFA])  ) ||
    buffer.subarray(0,2).equals(  Buffer.from([0xFF,0xF2])  ) ||
    buffer.subarray(0,3).equals(  Buffer.from([0x49,0x44,0x33])  )
  ) { return "mp3" }
  else { return "unknown" }
}
exports.getAudioType = getAudioType


const DT_UNKNOWN = 0x00
const DT_INT_8 = 0x01
const DT_INT_16 = 0x02
const DT_INT_32 = 0x03
const DT_INT_64 = 0x04
const DT_FLOAT_32 = 0x05
const DT_FLOAT_64 = 0x06
const DT_POSITION = 0x07
const DT_BUFFER = 0x08
const DT_STRING = 0x09
const DT_BUFFER_LONG = 0x0a
const DT_STRING_LONG = 0x0b
const DT_ARRAY = 0x0c

/**
 * @param {Buffer} file
 * @param {number} o
 * @param {boolean} skip_type
 * @param {boolean} skip_array_type
 * @param {number} type
 * @param {number} array_type
 * @returns {{result: any, off: number}}
 */
function read_data_type(file,o,skip_type=false,skip_array_type=false,type=DT_UNKNOWN,array_type=DT_UNKNOWN) {
  if (!skip_type){
    type = file.readUInt8(o); o += 1
  }
  switch (type) {
    case DT_INT_8:
      return { result: file.readUInt8(o), off: o + 1 }

    case DT_INT_16:
      return { result: file.readUInt16LE(o), off: o + 2 }

    case DT_INT_32:
      return { result: file.readUInt32LE(o), off: o + 4 }

    case DT_INT_64:
      return { result: Number(file.readBigUInt64LE()), off: o + 8 }

    case DT_FLOAT_32:
      return { result: file.readFloatLE(o), off: o + 4 }

    case DT_FLOAT_64:
      return { result: file.readDoubleLE(), off: o + 8 }

    case DT_POSITION:
      var value = {x: 5, y: 3}
      var t = file.readUInt8(o); o += 1
      if (t == 0) {
        value.x = file.readUInt8(o); o += 1
        value.y = file.readUInt8(o); o += 1
      } else if (t == 1) {
        value.x = file.readFloatLE(o); o += 4
        value.y = file.readFloatLE(o); o += 4
      } else { throw new Error("invalid position value type") }
      return { result: value, off: o }

    case DT_BUFFER:
      var size = file.readUInt16LE(o); o += 2
      return {result: file.get_buffer(size), off: o + size}

    case DT_STRING:
      var size = file.readUInt16LE(o); o += 2
      var buf = file.get_buffer(size)
      return { result: buf.toString("utf8"), off: o + size }

    case DT_BUFFER_LONG:
      var size = file.readUInt32LE(o); o += 4
      return { result: file.get_buffer(size), off: o + size }

    case DT_STRING_LONG:
      var size = file.readUInt32LE(o); o += 4
      var buf = file.get_buffer(size)
      return { result: buf.toString("utf8"), off: o + size }

    case DT_ARRAY:
      if (!skip_array_type) {
        array_type = file.readUInt8(o); o += 1
      }
      var arr = []
      var size = file.readUInt16LE(o); o += 2
      arr.resize(size)
      for (var i = 0; i < size; i++) {
        var r = read_data_type(file, o, true, false, array_type)
        o += r.off
        arr[i] = r.result
      }
      return { result: arr, off: o }
    
    default:
      throw new Error(`unknown data type ${type}`)
  }
}
exports.read_data_type = read_data_type