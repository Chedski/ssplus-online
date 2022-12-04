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
   * Specific integer difficulty rating of a song, with -1 being unrated.
   * Commonly written as 123*. 123★, ☆123, etc.
   * @type {number}
   */
  stars = -1;

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
    this.difficulty = (file.readInt8(o) - 1);  o += 1

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
      var music_format = util.getAudioType(file.slice(o,o+5))

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
    
    var note_data = file.slice(this.note_data_offset, this.note_data_offset + this.note_data_length)
    this.note_data_hash = crypto.createHash('sha256').update(note_data);
  }

  /**
   * Reads all available metadata from a .sspm file.
   * @param {string} path
   */
  load(path) {
    this.path = path

    /** @type {Buffer} */
    var file = fs.readFileSync(path, {encoding: null})
    
    var sig = file.slice(0,4)
    if (!sspmSignature.equals(sig)) { throw "Invalid file signature" }

    var version = file.readInt16LE(4)
    this.version = version

    switch (version) {
      case 1:
        this._v1(file)
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
    if (this.cover_offset != undefined && this.cover_length != undefined) {
      var file = fs.readFileSync(this.path, {encoding: null})
      return file.slice(this.cover_offset, this.cover_offset + this.cover_length)
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
    if (this.music_offset != undefined && this.music_length != undefined) {
      var file = fs.readFileSync(this.path, {encoding: null})
      return file.slice(this.music_offset, this.music_offset + this.music_length)
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
    var dv = file.slice(this.note_data_offset, this.note_data_offset + this.note_data_length)

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
  getNotes() {
    switch (this.version) {
      case 1:
        return this._getNotes_v1()
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
    console.log(str)
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
      difficulty_name: DifficultyName[this.difficulty],
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

    return data
  }
}
exports.SSPM = SSPM