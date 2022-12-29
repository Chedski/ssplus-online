// @ts-check
const fs = require('fs');
const crypto = require('crypto');
const util = require('./util');
const path = require('path');
const config = require('./mapdb_config').config

/**
 * SS-style category-based map difficulty.
 * @readonly
 * @enum {number} Difficulty
 */
const Difficulty = {
  /** Displayed as N/A */
  UNKNOWN: -1,
  EASY: 0,
  MEDIUM: 1,
  HARD: 2,
  /** Usually written as "Logic?" */
  LOGIC: 3,
  /** Displayed as 助 */
  TASUKETE: 4
}
exports.Difficulty = Difficulty

/**
 * SS-style category-based map difficulty.
 * @readonly
 * @type {Object<Difficulty,string>}
 */
const DifficultyName = {
  [-1]: "N/A",
  [0]: "Easy",
  [1]: "Medium",
  [2]: "Hard",
  [3]: "LOGIC?",
  [4]: "助 (Tasukete)",
}
exports.DifficultyName = DifficultyName

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
 * Signature for .sspm files
 * @readonly
 * @type {Buffer}
 */
const sspmSignature = Buffer.from([0x53,0x53,0x2b,0x6d])

/**
 * Map data class
 */
class SSPM {
  /**
   * Unique ID used by the game to identify the map.  
   * Usually follows the format `mapper_artist_name_-_song_name`.
   * 
   * Must contain only lowercase letters, numbers, underscores, and dashes.
   * @type {string}
   */
  id = "_ERROR";

  /**
   * Absolute path to the map file's location in the filesystem.
   * @type {string}
   */
  path = "";

  /**
   * SSPM format version used by the map.
   * @type {number}
   */
  version = -1;
  
  /**
   * Name of the map, as displayed ingame.  
   * This will usually be the same as the song name.
   * @type {string}
   */
  name = "Unknown Artist - Unknown Song";

  /**
   * Name of the song used by the map.  
   * @type {string}
   */
  song = "Unknown Artist - Unknown Song";

  /**
   * Creator(s) of the map.  
   * One string per individual mapper.
   * @type {string[]}
   */
  author = [];

  /**
   * Category-based difficulty level of the map.  
   * See the Difficulty enum for values.
   * @type {Difficulty}
   */
  difficulty = -1;
  
  /**
   * Difficulty name, as a string.  
   * @type {string}
   */
  difficulty_name = "N/A";

  /**
   * Specific integer difficulty rating of a song, with -1 being unrated.
   * Commonly written as 123*. 123★, ☆123, etc.
   * @type {number}
   */
  stars = 0;

  /**
   * Millisecond timestamp of the song's last note, rounded up.
   * @type {number}
   */
  length_ms = 0;

  /**
   * Number of notes in the map.
   * @type {number}
   */
  note_count = 0;

  /**
   * Indicates if the map has a cover.
   * @type {boolean}
   */
  has_cover = false;

  /**
   * Path to a cached version of the map's cover, if one exists.
   * @type {import('fs').PathOrFileDescriptor?}
   */
  cover_path = "";
  
  /**
   * Indicates that the .sspm is missing its embedded music file.
   * @type {boolean}
   */
  broken = false;

  /**
   * Map database tags that apply to the map.
   * @type {string[]}
   */
  tags = [];

  /**
   * If the song used by the map contains slurs or heavy topics, include them here.
   * @type {string[]}
   */
  content_warnings = [];
  

  /**
   * Byte offset of the map's note data.
   * @type {number}
   */
  note_data_offset;

  /**
   * Byte offset of the map's note data.
   * @type {number}
   */
  note_data_length;

  /**
   * SHA256 hash of the note data binary block.
   * @type {crypto.Hash} 
   */
  note_data_hash;
  

  /**
   * Byte offset of the map's cover image.
   * @type {number?}
   */
  cover_offset;

  /**
   * Byte length of the map's cover image.
   * @type {number?}
   */
  cover_length;


  /**
   * Audio format used by the map's music.
   * @type {null|"mp3"|"ogg"}
   */
  music_format;

  /**
   * Byte offset of the map's music.
   * @type {number?}
   */
  music_offset;

  /**
   * Byte length of the map's music.
   * @type {number?}
   */
  music_length;

  /**
   * Byte offset of sspmv2 marker definitions.
   * @type {number}
   */
  marker_def_offset = 0;

  /**
   * Byte length of sspmv2 marker definitions.
   * @type {number}
   */
  marker_def_length = 0;

  /**
   * @type {number}
   */
  marker_count = 0;

  /** @type {Array} */
  marker_types = [];



  /**
   * Internal function for reading v1 SSPM files
   * @param {Buffer} file
   * @private
   */
  _v1(file) {
    var o = 6 // offset
    if (file.readInt16LE(o) != 0) { throw "Header reserved space is not 0" }
    o += 2

    // Metadata
    var line = util.readLine(file,o);  o = line.off
    this.id = line.text

    line = util.readLine(file,o);  o = line.off
    this.name = line.text
    this.song = line.text

    line = util.readLine(file,o);  o = line.off
    this.author = line.text.split(/[,\s]*(?:&|and|\+)\s*|,\s*/g)
    
    this.length_ms = file.readInt32LE(o);  o += 4
    this.note_count = file.readInt32LE(o);  o += 4
    this.marker_count = this.note_count
    this.difficulty = (file.readInt8(o) - 1);  o += 1
    this.difficulty_name = DifficultyName[this.difficulty]

    // Cover
    var cover_type = file.readInt8(o);  o += 1
    this.has_cover = (cover_type == 2) // We can't display Godot's raw image data.
    
    if (cover_type == 1 || cover_type == 2) {
      if (cover_type == 1) { o += 6 } // Skip Godot raw image values (h/w/etc)

      // This will work fine as long as the .sspm is less than 2 GB.
      // While it is possible to have files that large, we're not
      // going to allow them in the map database for obvious reasons.
      let buffer_length = Number(file.readBigInt64LE(o));  o += 8
      if (cover_type == 2) {
        this.cover_offset = o
        this.cover_length = buffer_length
      }
      o += buffer_length
    }

    // Music
    var music_type = file.readInt8(o);  o += 1
    if (music_type != 1) {
      this.broken = true
    } else {
      // See above
      let buffer_length = Number(file.readBigInt64LE(o));  o += 8
      var music_format = util.getAudioType(file.subarray(o,o+5))

      if (music_format == "unknown") {
        this.broken = true
      } else {
        this.music_format = music_format
        this.music_offset = o
        this.music_length = buffer_length
      }

      o += buffer_length
    }

    // Notes
    this.note_data_offset = o
    this.note_data_length = (file.byteLength - o)
    
    // var note_data = file.subarray(this.note_data_offset, this.note_data_offset + this.note_data_length)
    // this.note_data_hash = crypto.createHash('sha256').update(note_data);
  }

  /**
   * Internal function for reading v2 SSPM files
   * @param {Buffer} file
   * @private
   */
  _v2(file) {
    var o = 6 // offset
    if (file.readInt32LE(o) != 0) { throw "Header reserved space is not 0" }
    o += 4

    o += 20 // marker hash

    this.length_ms = file.readUInt32LE(o); o += 4
    this.note_count = file.readUInt32LE(o); o += 4
    this.marker_count = file.readUInt32LE(o); o += 4
    this.difficulty = (file.readUInt8(o) - 1); o += 1
    this.stars = file.readUInt16LE(o); o += 2
    this.broken = !Boolean(file.readUInt8(o)); o += 1
    this.has_cover = Boolean(file.readUInt8(o)); o += 1
    if (Boolean(file.readUInt8(o) - 1)) {
      this.tags.push("modded")
    }; o += 1

    var cdb_offset = Number(file.readBigInt64LE(o)); o += 8
    var cdb_length = Number(file.readBigInt64LE(o)); o += 8
    this.music_offset = Number(file.readBigUInt64LE(o)); o += 8
    this.music_length = Number(file.readBigUInt64LE(o)); o += 8
    this.cover_offset = Number(file.readBigUInt64LE(o)); o += 8
    this.cover_length = Number(file.readBigUInt64LE(o)); o += 8
    this.marker_def_offset = Number(file.readBigUInt64LE(o)); o += 8
    this.marker_def_length = Number(file.readBigUInt64LE(o)); o += 8
    this.note_data_offset = Number(file.readBigUInt64LE(o)); o += 8
    this.note_data_length = Number(file.readBigUInt64LE(o)); o += 8

    // Metadata
    var len = file.readUInt16LE(o); o += 2
    this.id = file.subarray(o, o + len).toString("utf8"); o += len

    len = file.readUInt16LE(o); o += 2
    this.name = file.subarray(o, o + len).toString("utf8"); o += len
    len = file.readUInt16LE(o); o += 2
    this.song = file.subarray(o, o + len).toString("utf8"); o += len

    this.author = []
    var num = file.readUInt16LE(o); o += 2
    for (var i = 0; i < num; i++) {
      len = file.readUInt16LE(o); o += 2
      this.author.push(file.subarray(o, o + len).toString("utf8")); o += len
    }
    
    o = cdb_offset
    var field_count = file.readUInt16LE(o); o += 2

    this.difficulty_name = DifficultyName[this.difficulty]
    for (var i = 0; i < field_count; i++) {
      len = file.readUInt16LE(o); o += 2
      var n = file.subarray(o, o + len).toString("utf8"); o += len
      var r = util.read_data_type(file, o, false, false)
      o = r.off
      if (n == "difficulty_name") {
        this.difficulty_name = r.result
      }
    }

    o = this.marker_def_offset

    this.marker_types = []
    var marker_type_count = file.readUInt8(o); o += 1

    for (var i = 0; i < marker_type_count; i++) {
      var t = []
      this.marker_types[i] = t
      var len = file.readUInt16LE(o); o += 2
      var name = file.subarray(o, o + len).toString("utf8"); o += len
      t.push(name)

      var typecount = file.readUInt8(o); o += 1
      
      for (var j = 1; j < typecount + 1; j++){
        var type = file.readUInt8(o); o += 1
        t.push(type)
      }
      o += 1
    }
  }

  /**
   * Reads all available metadata from a .sspm file.
   * @param {string} path
   */
  load(path) {
    this.path = path

    /** @type {Buffer} */
    var file = fs.readFileSync(path, {encoding: null})
    
    var sig = file.subarray(0,4)
    if (!sspmSignature.equals(sig)) { throw "Invalid file signature" }

    var version = file.readInt16LE(4)
    this.version = version

    switch (version) {
      case 1:
        this._v1(file)
        break
      case 2:
        this._v2(file)
        break
      default:
        console.log("Unknown .sspm version")
        return
    }

    if (this.id.startsWith("ss_archive")) {
      this.tags.unshift("ss_archive")
    }
  }
  
  /**
   * Gets the cover image as a Buffer.
   * @returns {Buffer}
   */
   getCover() {
    if (this.path == "") { throw "No file loaded" }
    if (this.has_cover && this.cover_offset != undefined && this.cover_length != undefined) {
      var file = fs.readFileSync(this.path, {encoding: null})
      return file.subarray(this.cover_offset, this.cover_offset + this.cover_length)
    } else {
      throw "File does not have a cover"
    }
  }

  /**
   * Gets the map's music as a Buffer.
   * @returns {Buffer}
   */
  getAudio() {
    if (this.path == "") { throw "No file loaded" }
    if (!this.broken && this.music_offset != undefined && this.music_length != undefined) {
      var file = fs.readFileSync(this.path, {encoding: null})
      return file.subarray(this.music_offset, this.music_offset + this.music_length)
    } else {
      throw "File does not have audio"
    }
  }

  /**
   * Gets the .sspm as a Buffer.
   * @returns {Buffer}
   */
  getBuffer() {
    if (this.path == "") { throw "No file loaded" }
    return fs.readFileSync(this.path, {encoding: null})
  }


  /**
   * @returns {Array<Array<number>>}
   */
  _getNotes_v1() {
    
    var file = fs.readFileSync(this.path, {encoding: null})
    var dv = file.subarray(this.note_data_offset, this.note_data_offset + this.note_data_length)

    var off = 0

    var arr = []

    while (off < dv.byteLength) {
      var n = [dv.readUInt32LE(off)] ; off += 4
      var st = dv.readUInt8(off) ; off += 1
      if (st == 0) {
        n.push(dv.readUInt8(off)) ; off += 1
        n.push(dv.readUInt8(off)) ; off += 1
      } else if (st == 1) {
        n.push(dv.readFloatLE(off)) ; off += 4
        n.push(dv.readFloatLE(off)) ; off += 4
      } else {
        return []
      }
      arr.push(n)
    }
    return arr
  }

  /**
   * @returns {Array<Array<number>>}
   */
  _getNotes_v2() {
    var file = fs.readFileSync(this.path, {encoding: null})
    var o = this.note_data_offset
    
		var markers = {}

    /** @type {Array} */
		var mt_name = []

    /** @type {Array} */
		var mt_type = []

    /** @type {Array} */
		var mt_size = []
		
		for (var i = 0; i < this.marker_types.length; i++) {
      /** @type {Array} */
      var mt = this.marker_types[i]
			mt_name[i] = mt[0]
			mt_size[i] = 0
			markers[mt[0]] = []
			
			var mtt = []
			mt_type[i] = mtt

			for (var j = 1; j < mt.length; j++) {
				mtt[j-1] = mt[j]
				
				if (mt[j] == DT_POSITION ){
					mt_size[i] += 2
				} else {
					mt_size[i] += 1
        }
      }
		}

    for (var i = 0; i < this.marker_count; i++) {
      /** @type {Array} */
      var m = []
			var ms = file.readUInt32LE(o); o += 4
			var type_id = file.readUInt8(o); o += 1

      /** @type {string} */
			var name = mt_name[type_id]

      /** @type {Array} */
			var data = mt_type[type_id]

			var offset = 1
			m[0] = ms
			
			for (var ti = 0; ti < data.length; ti++) {
				var r = util.read_data_type(
					file,
          o,
					true,
					false,
					data[ti]
				)
        o = r.off
        var v = r.result
				
				if (data[ti] == DT_POSITION) {
					m[ti + offset] = v.x
					offset += 1
					m[ti + offset] = v.y
				} else {
					m[ti + offset] = v
        }
			}
			markers[name].push(m)
		}

    if (!markers.ssp_note) { throw new Error("no ssp_note?") }
		return markers.ssp_note
  }

  /**
   * @returns {Array<Array<number>>}
   */
  getNotes() {
    switch (this.version) {
      case 1:
        return this._getNotes_v1()
      case 2:
        return this._getNotes_v2()
      default:
        throw "Unknown .sspm version"
    }
  }

  /**
   * @returns {string}
   */
  getTxt() {
    var str = `${this.id}`
    var notes = this.getNotes()
    for (var n of notes) {
      str += `,${n[1]}|${n[2]}|${n[0]}`
    }
    return str
  }

  /** 
   * Gets clean data, for use in web result JSON
   * @returns {Object}
   */
  getClean() {
    var data = {
      id: this.id,
      download: config.download_path_prefix + this.id,
      txt: config.txt_path_prefix + this.id,
      audio: config.audio_path_prefix + this.id,
      cover: this.has_cover ? (config.cover_path_prefix + this.id) : null,
      version: this.version,
      name: this.name,
      song: this.song,
      author: this.author,
      difficulty: this.difficulty,
      difficulty_name: this.difficulty_name,
      stars: this.stars,
      length_ms: this.length_ms,
      note_count: this.note_count,
      has_cover: this.has_cover,
      broken: this.broken,
      tags: this.tags,
      content_warnings: this.content_warnings,
      note_data_offset: this.note_data_offset,
      note_data_length: this.note_data_length,
      cover_offset: this.cover_offset,
      cover_length: this.cover_length,
      music_format: this.music_format,
      music_offset: this.music_offset,
      music_length: this.music_length,
    }
    if (this.broken) { console.log("it borken") }

    return data
  }
}
exports.SSPM = SSPM