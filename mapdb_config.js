// @ts-check
const fs = require('fs');
const yaml = require('js-yaml');

/** @type {{map_folder:string, recursive:boolean, recurse_hidden:boolean, download_path_prefix:string, txt_path_prefix:string, audio_path_prefix:string, cover_path_prefix: string, port:number, trust_proxy:number}} */
// @ts-ignore
var config = yaml.load(fs.readFileSync('./config_mapdb.yml').toString())
exports.config = config