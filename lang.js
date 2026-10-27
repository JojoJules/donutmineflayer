'use strict'

const fs = require('fs')
const path = require('path')

let LANG = null

function loadLang () {
  if (LANG) return LANG
  LANG = Object.create(null)
  const file = path.join(__dirname, 'en_us.json')
  try {
    Object.assign(LANG, JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {}
  return LANG
}

const DEFAULT_BINDS = {
  'key.attack': 'key.mouse.left',
  'key.use': 'key.mouse.right',
  'key.forward': 'key.keyboard.w',
  'key.left': 'key.keyboard.a',
  'key.back': 'key.keyboard.s',
  'key.right': 'key.keyboard.d',
  'key.jump': 'key.keyboard.space',
  'key.sneak': 'key.keyboard.left.shift',
  'key.sprint': 'key.keyboard.left.control',
  'key.drop': 'key.keyboard.q',
  'key.inventory': 'key.keyboard.e',
  'key.chat': 'key.keyboard.t',
  'key.playerlist': 'key.keyboard.tab',
  'key.pickItem': 'key.mouse.middle',
  'key.command': 'key.keyboard.slash',
  'key.socialInteractions': 'key.keyboard.p',
  'key.screenshot': 'key.keyboard.f2',
  'key.togglePerspective': 'key.keyboard.f5',
  'key.smoothCamera': 'key.keyboard.unknown',
  'key.fullscreen': 'key.keyboard.f11',
  'key.spectatorOutlines': 'key.keyboard.unknown',
  'key.swapOffhand': 'key.keyboard.f',
  'key.saveToolbarActivator': 'key.keyboard.c',
  'key.loadToolbarActivator': 'key.keyboard.x',
  'key.advancements': 'key.keyboard.l',
  'key.hotbar.1': 'key.keyboard.1',
  'key.hotbar.2': 'key.keyboard.2',
  'key.hotbar.3': 'key.keyboard.3',
  'key.hotbar.4': 'key.keyboard.4',
  'key.hotbar.5': 'key.keyboard.5',
  'key.hotbar.6': 'key.keyboard.6',
  'key.hotbar.7': 'key.keyboard.7',
  'key.hotbar.8': 'key.keyboard.8',
  'key.hotbar.9': 'key.keyboard.9',
  'key.quickActions': 'key.keyboard.g',
  'key.toggleGui': 'key.keyboard.f1',
  'key.toggleSpectatorShaderEffects': 'key.keyboard.unknown',
  'key.spectatorHotbar': 'key.keyboard.unknown'
}

function nbtSimplify (node) {
  if (node == null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(nbtSimplify)
  if (Object.prototype.hasOwnProperty.call(node, 'type') && Object.prototype.hasOwnProperty.call(node, 'value')) {
    const t = node.type
    const v = node.value
    if (t === 'compound' && v && typeof v === 'object' && !Array.isArray(v)) {
      const out = {}
      for (const [k, child] of Object.entries(v)) out[k] = nbtSimplify(child)
      return out
    }
    if (t === 'list') {
      const items = v && typeof v === 'object' && Array.isArray(v.value) ? v.value : v
      return Array.isArray(items) ? items.map(nbtSimplify) : []
    }
    if (t === 'byte' || t === 'short' || t === 'int' || t === 'long' || t === 'float' || t === 'double' || t === 'string') {
      return v
    }
    if (Buffer.isBuffer(v)) return v
    return nbtSimplify(v)
  }
  const out = {}
  for (const [k, v] of Object.entries(node)) out[k] = nbtSimplify(v)
  return out
}

function keyDisplayName (keyId) {
  const id = String(keyId || '')
  const letter = /^key\.keyboard\.([a-z0-9])$/.exec(id)
  if (letter) return letter[1].toUpperCase()
  const dict = loadLang()
  if (dict[id]) return dict[id]
  if (id === 'key.keyboard.unknown') return 'Not Bound'
  return id
}

function resolveKeybind (id) {
  const bound = DEFAULT_BINDS[id]
  if (!bound) return String(id || '')
  return keyDisplayName(bound)
}

function formatTranslate (tmpl, args) {
  let auto = 0
  return String(tmpl).replace(/%%/g, '\0').replace(/%(?:(\d+)\$)?s/g, (_, n) => {
    const idx = n ? Number(n) - 1 : auto++
    return args[idx] != null ? String(args[idx]) : ''
  }).replace(/\0/g, '%')
}

function resolveComponent (node, depth = 0) {
  if (node == null || depth > 12) return ''
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (typeof node === 'string') {
    const s = node.trim()
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try { return resolveComponent(JSON.parse(node), depth + 1) } catch { return node }
    }
    return node
  }
  if (Array.isArray(node)) return node.map((part) => resolveComponent(part, depth + 1)).join('')
  const obj = nbtSimplify(node)
  if (obj == null || typeof obj !== 'object') return resolveComponent(obj, depth + 1)
  let out = ''
  if (obj.text != null && obj.text !== '') out += String(obj.text)
  if (obj.translate) {
    const dict = loadLang()
    const key = String(obj.translate)
    const tmpl = dict[key] != null ? dict[key] : (obj.fallback != null ? String(obj.fallback) : key)
    const args = []
    if (Array.isArray(obj.with)) {
      for (const arg of obj.with) args.push(resolveComponent(arg, depth + 1))
    }
    out += formatTranslate(tmpl, args)
  }
  if (obj.keybind) out += resolveKeybind(String(obj.keybind))
  if (obj.extra) out += resolveComponent(obj.extra, depth + 1)
  return out
}

function fourLines (messages) {
  const lines = ['', '', '', '']
  const list = Array.isArray(messages) ? messages : []
  for (let i = 0; i < 4; i++) {
    let text = resolveComponent(list[i])
    if (text.length > 384) text = text.slice(0, 384)
    lines[i] = text
  }
  return lines
}

function signLinesFromNbt (nbtData) {
  if (!nbtData) return null
  const simple = nbtSimplify(nbtData)
  if (!simple || typeof simple !== 'object') return null
  if (simple.front_text || simple.back_text) {
    return {
      front: fourLines(simple.front_text && simple.front_text.messages),
      back: fourLines(simple.back_text && simple.back_text.messages)
    }
  }
  if (simple.Text1 != null || simple.Text2 != null) {
    return {
      front: fourLines([simple.Text1, simple.Text2, simple.Text3, simple.Text4]),
      back: ['', '', '', '']
    }
  }
  if (simple.messages) {
    return { front: fourLines(simple.messages), back: ['', '', '', ''] }
  }
  return null
}

module.exports = {
  loadLang,
  resolveComponent,
  signLinesFromNbt,
  nbtSimplify
}
