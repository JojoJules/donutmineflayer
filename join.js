'use strict'

require('./checksum')
const mineflayer = require('mineflayer')
const { wrapAuth, attachVanilla, whenReady } = require('./vanilla')

function join (opts) {
  const host = String(opts.host || '')
  const port = Number(opts.port) || 25565
  const session = opts.session || {}
  const profile = session.selectedProfile || {}
  const username = String(opts.username || profile.name || '')
  const accessToken = String(opts.accessToken || session.accessToken || '')
  const uuidHex = String(opts.uuid || profile.id || '').replace(/-/g, '')
  const bot = mineflayer.createBot({
    host,
    port,
    username,
    auth: wrapAuth((client, options) => {
      const selected = { id: uuidHex, name: username }
      const sessionObj = {
        accessToken,
        selectedProfile: selected,
        availableProfiles: [selected]
      }
      client.session = sessionObj
      client.username = username
      if (uuidHex) client.uuid = uuidHex
      options.accessToken = accessToken
      options.haveCredentials = true
      client.emit('session', sessionObj)
      options.connect(client)
    }),
    brand: 'vanilla',
    version: opts.version || '1.21.11',
    viewDistance: 8,
    hideErrors: true,
    respawn: true,
    clientSettings: {
      locale: 'en_us',
      viewDistance: 8,
      chatFlags: 0,
      chatColors: true,
      skinParts: 127,
      mainHand: 1,
      enableTextFiltering: false,
      enableServerListing: true,
      particleStatus: 'all'
    },
    plugins: {
      resource_pack: true
    }
  })
  attachVanilla(bot)
  return bot
}

module.exports = { join, whenReady }
