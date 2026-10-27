'use strict'

const crypto = require('crypto')
const uuid = require('uuid-1345')
const { Endpoints, fetchOptions } = require('prismarine-auth/src/common/Constants')
const { checkStatus } = require('prismarine-auth/src/common/Util')
const lang = require('./lang')

const CERT_CACHE = new Map()

function toDER (pem) {
  return pem.split('\n').slice(1, -1).reduce((acc, cur) => Buffer.concat([acc, Buffer.from(cur, 'base64')]), Buffer.alloc(0))
}

async function fetchCertificates (accessToken) {
  const key = String(accessToken || '').slice(0, 24)
  const hit = CERT_CACHE.get(key)
  if (hit && hit.profileKeys && hit.profileKeys.expiresOn && hit.profileKeys.expiresOn.getTime() - Date.now() > 5 * 60 * 1000) {
    return hit
  }
  const headers = { ...fetchOptions.headers, Authorization: 'Bearer ' + accessToken }
  const cert = await fetch(Endpoints.minecraftJava.certificates, { method: 'POST', headers }).then(checkStatus)
  const profileKeys = {
    publicPEM: cert.keyPair.publicKey,
    privatePEM: cert.keyPair.privateKey,
    publicDER: toDER(cert.keyPair.publicKey),
    privateDER: toDER(cert.keyPair.privateKey),
    signature: Buffer.from(cert.publicKeySignature, 'base64'),
    signatureV2: Buffer.from(cert.publicKeySignatureV2, 'base64'),
    expiresOn: new Date(cert.expiresAt),
    refreshAfter: new Date(cert.refreshedAfter)
  }
  profileKeys.public = crypto.createPublicKey({ key: profileKeys.publicDER, format: 'der', type: 'spki' })
  profileKeys.private = crypto.createPrivateKey({ key: profileKeys.privateDER, format: 'der', type: 'pkcs8' })
  const packed = { profileKeys }
  CERT_CACHE.set(key, packed)
  return packed
}

function sendChatSession (client) {
  if (!client || !client.profileKeys || !client.cipher) return false
  try {
    client._session = { index: 0, uuid: uuid.v4fast() }
    client.write('chat_session_update', {
      sessionUUID: client._session.uuid,
      expireTime: BigInt(client.profileKeys.expiresOn.getTime()),
      publicKey: client.profileKeys.public.export({ type: 'spki', format: 'der' }),
      signature: client.profileKeys.signatureV2
    })
    return true
  } catch {
    return false
  }
}

function randomSalt () {
  return crypto.randomBytes(8).readBigInt64BE()
}

function wrapSignedChat (client) {
  const orig = client._signedChat
  if (typeof orig !== 'function' || orig._saltFix) return
  const wrapped = (message, options = {}) => {
    if (options.salt == null || options.salt === 1n) options.salt = randomSalt()
    return orig(message, options)
  }
  wrapped._saltFix = true
  client._signedChat = wrapped
  client.chat = wrapped
}

function wrapAuth (inner) {
  return (client, options) => {
    const origConnect = options.connect
    options.connect = (c) => {
      const token = options.accessToken || (c.session && c.session.accessToken)
      const go = async () => {
        if (token && !c.profileKeys) {
          try {
            Object.assign(c, await fetchCertificates(token))
          } catch {}
        }
        origConnect(c)
      }
      go().catch((err) => c.emit('error', err))
    }
    return inner(client, options)
  }
}

function posKey (location) {
  if (!location) return ''
  return location.x + ',' + location.y + ',' + location.z
}

function attachSignProbe (bot) {
  const client = bot._client
  if (client._signProbe) return
  client._signProbe = true
  const signs = new Map()
  let sentForOpen = false

  const remember = (location, nbtData) => {
    const parsed = lang.signLinesFromNbt(nbtData)
    if (!location || !parsed) return null
    const key = posKey(location)
    signs.set(key, parsed)
    if (signs.size > 256) {
      const first = signs.keys().next().value
      signs.delete(first)
    }
    return parsed
  }

  const reply = (packet) => {
    if (!packet || !packet.location || sentForOpen) return
    const stored = signs.get(posKey(packet.location))
    const side = packet.isFrontText === false ? 'back' : 'front'
    const texts = (stored && stored[side]) || ['', '', '', '']
    try {
      client.write('update_sign', {
        location: packet.location,
        isFrontText: packet.isFrontText !== false,
        text1: texts[0] || '',
        text2: texts[1] || '',
        text3: texts[2] || '',
        text4: texts[3] || ''
      })
      sentForOpen = true
    } catch {}
  }

  client.on('tile_entity_data', (packet) => {
    const parsed = remember(packet.location, packet.nbtData)
    if (!parsed) return
    const open = client._openSign
    if (open && posKey(open.location) === posKey(packet.location)) reply(open)
  })

  client.on('open_sign_entity', (packet) => {
    sentForOpen = false
    client._openSign = packet
    if (signs.has(posKey(packet.location))) {
      reply(packet)
      return
    }
    setTimeout(() => {
      if (client._openSign === packet) reply(packet)
    }, 50)
  })

  client.on('close_window', () => {
    const open = client._openSign
    if (open) reply(open)
    client._openSign = null
    client._anvilOpen = null
  })

  client.on('open_window', (packet) => {
    const title = lang.resolveComponent(packet && packet.windowTitle)
    const anvil = packet && (packet.inventoryType === 8 || /repair/i.test(title))
    client._anvilOpen = anvil ? packet.windowId : null
  })

  client.on('window_items', (packet) => {
    if (client._anvilOpen == null || !packet || packet.windowId !== client._anvilOpen) return
    maybeNameItem(client, packet.items && packet.items[0])
  })
  client.on('set_slot', (packet) => {
    if (client._anvilOpen == null || !packet || packet.windowId !== client._anvilOpen) return
    if (packet.slot !== 0) return
    maybeNameItem(client, packet.item)
  })
}

function itemNameComponent (item) {
  if (!item) return null
  const nbt = item.nbt || item.components || item
  const simple = lang.nbtSimplify(nbt)
  if (!simple || typeof simple !== 'object') return null
  const custom = simple.custom_name || simple['minecraft:custom_name'] || (simple.display && simple.display.Name)
  if (custom) return custom
  const components = simple.components
  if (components && typeof components === 'object') {
    return components['minecraft:custom_name'] || components.custom_name || null
  }
  return null
}

function maybeNameItem (client, item) {
  const component = itemNameComponent(item)
  if (component == null) return
  const resolved = lang.resolveComponent(component)
  const raw = typeof component === 'string' ? component : JSON.stringify(component)
  if (!/translate|keybind/i.test(raw) && resolved === raw) return
  if (client._namedItem === resolved) return
  client._namedItem = resolved
  try {
    client.write('name_item', { name: resolved.slice(0, 50) })
  } catch {}
}

function attachTickEnd (bot) {
  const client = bot._client
  if (client._tickEnd) return
  client._tickEnd = true
  const timer = setInterval(() => {
    if (client.state !== 'play') return
    try { client.write('tick_end', {}) } catch {}
  }, 50)
  if (timer.unref) timer.unref()
  const stop = () => clearInterval(timer)
  bot.once('end', stop)
  client.once('end', stop)
}

function attachPlayerLoaded (bot) {
  const client = bot._client
  if (client._playerLoadedHook) return
  client._playerLoadedHook = true
  let last = 0
  const send = () => {
    if (client.state !== 'play') return
    if (Date.now() - last < 800) return
    last = Date.now()
    try { client.write('player_loaded', {}) } catch {}
  }
  client.on('login', () => setTimeout(send, 80))
  client.on('respawn', () => setTimeout(send, 80))
  bot.on('spawn', () => { last = Date.now() })
}

function attachVanilla (bot) {
  const client = bot && bot._client
  if (!client || client._vanillaAttached) return
  client._vanillaAttached = true
  bot._vanillaReadyAt = Date.now() + 3500
  lang.loadLang()
  attachSignProbe(bot)
  attachTickEnd(bot)
  attachPlayerLoaded(bot)

  client.on('start_configuration', () => {
    client._needChatSession = true
  })
  client.on('login', () => {
    wrapSignedChat(client)
    if (client._session && !client._needChatSession) return
    sendChatSession(client)
    client._needChatSession = false
  })
  client.on('playerJoin', () => wrapSignedChat(client))
  bot.once('spawn', () => wrapSignedChat(client))
}

function whenReady (bot) {
  const wait = Math.max(0, (bot._vanillaReadyAt || 0) - Date.now())
  return new Promise((resolve) => setTimeout(resolve, wait))
}

module.exports = {
  fetchCertificates,
  wrapAuth,
  attachVanilla,
  sendChatSession,
  whenReady
}
