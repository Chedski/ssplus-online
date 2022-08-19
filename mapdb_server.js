// @ts-check
const fs = require('fs');
const path = require('path');
const sspm = require('./sspm');
const {config} = require('./mapdb_config')
const express = require('express');
const {rateLimit} = require('express-rate-limit');
const app = express()
app.set('trust proxy', config.trust_proxy)

if (!fs.existsSync(config.map_folder)) {
  throw "Map folder does not exist"
}

/**
 * @param {number} status
 * @param {string} extraContent
 */
function httpcat(status, extraContent="") {
  var result = `<html><head><style>
    body {
      background-color: #000000;
      display: flex;
      justify-content: space-around;
      align-items: center;
      flex-direction: column;
      color: #ffffff;
      height: 100%;
      overflow: hidden;
    }
    p {
      width: 585px;
    }
    </style>
    <title>HTTP ${status}. Here's a cat.</title></head>
    <body><img src="https://http.cat/${status}">${extraContent}</body></html>`
  return result
}

/**
 * @param {string} dir
 * @returns {sspm.SSPM[]}
 */
function findMapsInFolder(dir) {
  var maps = []
  var files = fs.readdirSync(dir,{withFileTypes: true})
  files.forEach((ent) => {
    if (config.recursive && ent.isDirectory()) {
      var res = findMapsInFolder(path.join(dir,ent.name))
      res.forEach((map) => {
        try {
          maps.push(map)
        } catch(err) {
          console.error(err)
        }
      })
    } else if (ent.isFile() && path.extname(ent.name) == ".sspm") {
      var map = new sspm.SSPM()
      map.load(path.join(dir,ent.name))
      try {
        console.log(map.id)
        maps.push(map)
      } catch(err) {
        console.error(err)
      }
    }
  })

  return maps
}

var maps_array = findMapsInFolder(config.map_folder)

/** @type {Object<string,sspm.SSPM>} */
var maps = {}
var maps_clean = {}
maps_array.forEach((m) => {
  maps[m.id] = m
  maps_clean[m.id] = m.getClean()
})

var maps_json = JSON.stringify(maps_clean)

console.log("MAPS LOADED")

app.use('/api/download/', (req,res) => {
  var id = req.url.replace(/^\//,"")
  console.log("DOWNLOAD: " + id)

  if (maps.hasOwnProperty(id)) {
    var map = maps[id]
    res.setHeader("Content-Disposition",`attachment; filename="${id}.sspm"`)  
    res.send(map.getBuffer())
  } else {
    res.status(404).send(httpcat(404))
  }
})

app.use('/api/audio/', (req,res) => {
  var id = req.url.replace(/^\//,"")
  console.log("AUDIO: " + id)

  if (maps.hasOwnProperty(id)) {
    var map = maps[id]
    res.setHeader("Content-Type","audio/" + map.music_format)
    res.send(map.getAudio())
  } else {
    res.status(404).send(httpcat(404))
  }
})

app.use('/api/cover/', (req,res) => {
  var id = req.url.replace(/^\//,"")
  console.log("COVER: " + id)

  if (maps.hasOwnProperty(id)) {
    var map = maps[id]
    res.setHeader("Content-Type","image/png")
    res.send(map.getCover())
  } else {
    res.status(404).send(httpcat(404))
  }
})




const limiter = rateLimit({
	windowMs: 15 * 1000,
	max: 40,
	standardHeaders: true,
	message: httpcat(429),
})
app.use("/api/filter",limiter)

var filter_cache = {}

app.get('/api/filter/difficulty', (req, res) => {
  console.log("/api/difficulty")
  console.log(req.originalUrl)
  if (req.query.hasOwnProperty("filter")) {

    console.log(req.query.filter)

    var filter = String(req.query.filter).split(",")
    var valid = true
    filter.forEach((f) => { if (isNaN(parseInt(f))) { valid = false } })
    if (!valid) {
      res.setHeader("Content-Type","text/html")
      res.status(400).send(httpcat(400))
      return
    }
    console.log(filter)
    
    var results = []
    maps_array.forEach((map) => {
      if (filter.some((v) => { return parseInt(v) == map.difficulty })) {
        results.push(map.getClean())
      }
    })

    var json = JSON.stringify(results)
    res.setHeader("Content-Type","application/json")
    res.send(json)

  } else {
    res.setHeader("Content-Type","text/html")
    res.status(400).send(httpcat(400))
  }
})

app.get('/api/all', (req, res) => {
  console.log("/api/all")
  var results = []
  res.setHeader("Content-Type","application/json")
  res.send(maps_json)
})

app.get('/api', (req, res) => {
  console.log("/api")
  res.setHeader("Content-Type","text/plain")
  res.send(`
  # API Information
  ## Listing maps
  \` /ssp/mapdb/api/all \` - Gets a list of all maps
  \` /ssp/mapdb/api/filter/difficulty?filter=-1,0,1,2,3,4 \` - Filter by difficulty
  
  ## Downloads
  \` /ssp/mapdb/api/audio/<id> \` - Downloads a map's audio as mp3 or ogg
  \` /ssp/mapdb/api/cover/<id> \` - Downloads a map's cover image, if it has one
  \` /ssp/mapdb/api/download/<id> \` - Downloads the map

  `)
})

// 404
app.all('*', (req, res) => {
  res.status(404).send(httpcat(404))
})


app.listen(config.port, () => {
  console.log(`listening on port ${config.port}`)
})