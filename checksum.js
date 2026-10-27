'use strict'

function patchChatChecksum () {
  const checksumPath = require.resolve('minecraft-protocol/src/datatypes/checksums')
  if (require.cache[checksumPath] && require.cache[checksumPath].exports && require.cache[checksumPath].exports._signedFix) return
  function computeChatChecksum (lastSeenMessages) {
    if (!lastSeenMessages || lastSeenMessages.length === 0) return 1
    let checksum = 1
    for (const message of lastSeenMessages) {
      const sig = message.signature
      if (!sig) continue
      let sigHash = 1
      for (let i = 0; i < sig.length; i++) {
        const b = sig[i] > 127 ? sig[i] - 256 : sig[i]
        sigHash = (31 * sigHash + b) | 0
      }
      checksum = (31 * checksum + sigHash) | 0
    }
    let result = checksum & 0xff
    if (result === 0) result = 1
    if (result > 127) result -= 256
    return result
  }
  computeChatChecksum._signedFix = true
  require.cache[checksumPath] = {
    id: checksumPath,
    filename: checksumPath,
    loaded: true,
    exports: { computeChatChecksum }
  }
}

patchChatChecksum()
