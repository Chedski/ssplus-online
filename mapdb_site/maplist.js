// @ts-check
history.scrollRestoration = "manual"

/*
  Difficulties:
	-1    N/A       #ffffff
	 0    Easy      #00ff00
	 1    Medium    #ffb900
	 2    Hard      #ff0000
	 3    LOGIC?    #d76aff
	 4    助        #36304f
*/

const diffClass = {
  [-1]: "na",
  [0]: "easy",
  [1]: "medium",
  [2]: "hard",
  [3]: "logic",
  [4]: "tasukete",
}
const diffName = {
  [-1]: "N/A",
  [0]: "EASY",
  [1]: "MEDIUM",
  [2]: "HARD",
  [3]: "LOGIC?",
  [4]: "&#21161;", // 助
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatTime(ms) {
  var d = ms / 1000
  var h = Math.floor(d / 3600);
  var m = Math.floor(d % 3600 / 60);
  var s = Math.floor(d % 3600 % 60);

  return (h != 0 ? (((h < 10 ? '0' : '') + h).slice(-2) + ":") : "") + ((h != 0 ? '0' : '') + m).slice(-2) + ":" + ('0' + s).slice(-2);
}

/**
 * @param {string} text
 * @param {string[] | string[][]} classes
 * @returns {HTMLSpanElement}
 */
function makeSpan(text,...classes) {
  if (classes[0] instanceof Array) { classes = classes[0] }
  var span = document.createElement("span")
  classes.forEach((c) => { span.classList.add(c) })
  span.innerText = text
  return span
}

/**
 * @param {string[] | string[][]} classes
 * @returns {HTMLDivElement}
 */
 function makeDiv(...classes) {
  if (classes[0] instanceof Array) { classes = classes[0] }
  var div = document.createElement("div")
  classes.forEach((c) => { div.classList.add(c) })
  return div
}

/**
 * @param {HTMLElement} parent
 * @param {string[] | string[][]} classes
 * @returns {HTMLDivElement}
 */
function makeDivUnder(parent,...classes) {
  var div = makeDiv(...classes)
  parent.appendChild(div)
  return div
}

/**
 * @param {HTMLElement} parent
 * @param {string} text
 * @param {string[] | string[][]} classes
 * @returns {HTMLSpanElement}
 */
function makeSpanUnder(parent,text,...classes) {
  var span = makeSpan(text,...classes)
  parent.appendChild(span)
  return span
}

/**
 * @typedef {{
 * id:string,
 * download:string,
 * audio:string?,
 * cover:string?, 
 * version:number,
 * name:string,
 * song:string,
 * author:string[],
 * difficulty:number,
 * stars:number,
 * length_ms:number,
 * note_count:number,
 * has_cover:boolean,
 * broken:boolean,
 * tags:string[],
 * content_warnings:string[]
 * }} SSPM
 */

/**
 * @param {SSPM} map
 */
function makeMapNode(map) {
  var main = makeDiv("item", diffClass[map.difficulty])
  var coverholder = makeDivUnder(main,"coverholder")
  
  if (map.cover && map.has_cover) {
    var cover = document.createElement("img")
    cover.src = map.cover
    coverholder.appendChild(cover)
  } else {
    makeSpanUnder(coverholder,map.name)
  }

  if (map.broken) { main.classList.add("broken") }


  var info = makeDivUnder(main,"info")
  makeSpanUnder(info,map.name,"mapname")
  var metaSpan = makeSpanUnder(info,"","metadata")
  makeSpanUnder(metaSpan,`${formatTime(map.length_ms)} - ${map.note_count.toLocaleString()} notes`)
  map.tags.forEach((tag) => {
    switch (tag) {
      case "ost": makeSpanUnder(metaSpan,"SS+ OST","tag","tag_ost"); break
      case "curators_choice": makeSpanUnder(metaSpan,"Curator's Choice","tag","tag_cc"); break
      case "ss_archive": makeSpanUnder(metaSpan,"SS Map Archive","tag"); break
    }
  })

  var creators = makeSpanUnder(info,"","creators")
  makeSpanUnder(creators,"Map by ")
  var first = true
  map.author.forEach((n) => {
    if (!first) { makeSpanUnder(creators,", ") }
    first = false
    makeSpanUnder(creators,n,"creator")
  })

  var options = makeDivUnder(info,"options")

  var download_a = document.createElement("a")
  download_a.href = "/ssp/mapdb/api/download/" + map.id
  var download_btn = document.createElement("button")
  download_btn.classList.add("download")
  download_btn.innerText = "Download"
  download_a.appendChild(download_btn)
  options.appendChild(download_a)
  
  var audio = document.createElement("audio")
  audio.preload = "none"
  audio.controls = true
  var source = document.createElement("source")
  source.src = "/ssp/mapdb/api/audio/" + map.id
  audio.appendChild(source)
  options.appendChild(audio)


  var info2 = makeDivUnder(main,"info","info2")
  var diff = makeSpanUnder(info2,diffName[map.difficulty],"difficulty")
  if (map.difficulty == 4) { diff.innerHTML = diffName[4] } // makeSpanUnder uses .innerText, which doesn't work for this case.

  document.getElementById("list")?.appendChild(main)
  return main
}


var loaded_maps = 0
var maps = {}
var maps_arr = []

var sorted_maps = []


/** @type {HTMLDivElement} */
// @ts-ignore
var list = document.getElementById("list")
var lastScrollTop = 0

// -1 = highest first, 0 = ignored, 1 = lowest first
var sort_difficulty = 1
var sort_rev = 1 // -1 to reverse
/*
  0 = name only
  1 = stars
  2 = length (time)
  3 = notes
  (all of these sort by name after)
*/
var sort_order = 0

var reverse_name_sort = false
var show_broken = false

var tag_filter = []
var difficulty_filter = {
  [-1]: true,
  [0]:  true,
  [1]:  true,
  [2]:  true,
  [3]:  true,
  [4]:  true
}

/**
 * @param {SSPM} a
 * @param {SSPM} b
 */
function sort_map(a,b) {
  if (sort_difficulty != 0 && a.difficulty != b.difficulty) {
    if (sort_difficulty == -1) {
      return a.difficulty < b.difficulty
    } else {
      return a.difficulty > b.difficulty
    }
  }

  var result = false

  function name() {
    var an = a.name.toLowerCase()
    var bn = b.name.toLowerCase()
    if (an == bn) {
      an = a.id
      bn = b.id
    }
    if ((sort_rev == -1) == reverse_name_sort) {
      result = an > bn
    } else {
      result = an < bn
    }
  }
  function stars() {
    var av = a.stars * sort_rev
    var bv = b.stars * sort_rev
    if (av == bv) {
      name()
      return
    }
    result = av < bv
  }
  function len() {
    var av = a.length_ms * sort_rev
    var bv = b.length_ms * sort_rev
    if (av == bv) {
      name()
      return
    }
    result = av < bv
  }
  function notes() {
    var av = a.note_count * sort_rev
    var bv = b.note_count * sort_rev
    if (av == bv) {
      name()
      return
    }
    result = av < bv
  }

  switch (sort_order) {
    case 0: name(); return result
    case 1: stars(); return result
    case 2: len(); return result
    case 3: notes(); return result
  }

  return result

}


var reloading_maps = false
function sortAndFilter() {
  reloading_maps = true

  list.innerHTML = ""
  lastScrollTop = 0
  loaded_maps = 0
  sorted_maps = []

  maps_arr.forEach(
    /** @param {SSPM} map */
    (map) => {
      if (map.broken && !show_broken) { return }
      if (!difficulty_filter[map.difficulty]) { return }
      var include = true
      tag_filter.forEach((tag) => {
        if (!map.tags.some((v) => { return v == tag })) { include = false }
      })
      if (!include) { return }

      sorted_maps.push(map)
    }
  )
  
  // @ts-ignore
  sorted_maps.sort(sort_map)
  
  reloading_maps = false

  for (let i = 0; i < 16; i++) {
    if (loaded_maps >= sorted_maps.length) { break }
    makeMapNode(sorted_maps[loaded_maps])
    loaded_maps++
  }
}

var xhr = new XMLHttpRequest()
xhr.onload = () => {
  if (xhr.status == 200) {
    maps = JSON.parse(xhr.response)
    maps_arr = Object.values(maps)

    sortAndFilter()
    
    list.addEventListener("scroll", () => {
      var st = list.scrollTop
      if (list.scrollTop > lastScrollTop) {
        if (list.scrollTop + list.offsetHeight >= (list.scrollHeight - 200)) {
          for (let i = 0; i < 4; i++) {
            if (reloading_maps || loaded_maps >= sorted_maps.length) { break }
            makeMapNode(sorted_maps[loaded_maps])
            loaded_maps++
          }
        }
      }
      lastScrollTop = st <= 0 ? 0:st
    }, false);
  } else {
    var cover = document.createElement("img")
    cover.src = "https://http.cat/" + xhr.status
    list.appendChild(cover)
  }
}
xhr.open("GET", "/ssp/mapdb/api/all", true)
xhr.send()

