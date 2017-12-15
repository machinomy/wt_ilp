'use strict'

const EventEmitter = require('events').EventEmitter
const inherits = require('inherits')
const bencode = require('bencode')
const debug = require('debug')('mc_payment_handshake')

/**
 * Returns a bittorrent extension
 * @param {String} opts.ethereumAddress Ethereum address
 * @return {BitTorrent Extension}
 */
module.exports = function (opts) {

  const MessageType = {
    SendAddress: 0
  }

  if (!opts) {
    opts = {}
  }

  inherits(mc_payment_handshake, EventEmitter)

  function mc_payment_handshake (wire, ethereumAddress) {
    EventEmitter.call(this)
    debug('mc_payment_handshake instantiated')

    this._wire = wire

    this.ethereumAddress = ethereumAddress
    this.host = opts.host
    this.port = opts.port

    // Peer fields will be set once the extended handshake is received
    this.peerAddress = null
    this.peerHost = null
    this.peerPort = null

    this.amForceChoking = false

    // Add fields to extended handshake, which will be sent to peer
    this._wire.extendedHandshake.ethereumAddress = this.ethereumAddress

    debug('Extended handshake to send:', this._wire.extendedHandshake)

    this._interceptRequests()
  }

  mc_payment_handshake.prototype.name = 'mc_payment_handshake'

  mc_payment_handshake.prototype.onHandshake = function (infoHash, peerId, extensions) {
    // noop
  }

  mc_payment_handshake.prototype.onExtendedHandshake = function (handshake) {
    if (!handshake.m || !handshake.m.mc_payment_handshake) {
      return this.emit('mc_payment_handshake_not_supported', new Error('Peer does not support mc_payment_handshake'))
    }

    if (handshake.mc_ph_address) {
      this.peerAddress = handshake.mc_ph_address.toString('utf8')
    }

    this.emit('mc_payment_handshake', {
      ethereumAddress: this.ethereumAddress
    })
  }

  mc_payment_handshake.prototype.onMessage = function (buf) {
    let dict
    try {
      const str = buf.toString()
      const trailerIndex = str.indexOf('ee') + 2
      dict = bencode.decode(str.substring(0, trailerIndex))
    } catch (err) {
      // drop invalid messages
      return
    }
    const ethereumAddress = Buffer.isBuffer(dict.ethereumAddress) ? dict.ethereumAddress.toString('utf8') : ''
    switch (dict.msg_type) {
      case MessageType.SendAddress:
        debug('Got opposite ethereumAddress: ' + ethereumAddress + ' from ' + this.peerHost + ':' + this.peerPort)
        this.emit('got_address', ethereumAddress)
        break
      default:
        debug('Got unknown message: ', dict)
        break
    }
  }

  mc_payment_handshake.prototype.forceChoke = function () {
    debug('force choke peer ' + this.peerHost + ':' + this.peerPort)
    this.amForceChoking = true
    this._wire.choke()
  }

  mc_payment_handshake.prototype.unchoke = function () {
    debug('unchoke' + this.peerHost + ':' + this.peerPort)
    this.amForceChoking = false
  }

  mc_payment_handshake.prototype._interceptRequests = function () {
    const _this = this
    const _onRequest = this._wire._onRequest
    this._wire._onRequest = function (index, offset, length) {
      _this.emit('request', length)

      // Call onRequest after the handlers triggered by this event have been called
      const _arguments = arguments
      setTimeout(function () {
        if (!_this.amForceChoking) {
          debug('responding to request')
          _onRequest.apply(_this._wire, _arguments)
        } else {
          debug('force choking peer, dropping request')
        }
      }, 0)
    }
  }

  mc_payment_handshake.prototype._send = function (dict) {
    this._wire.extended('mc_payment_handshake', bencode.encode(dict))
  }

  mc_payment_handshake.prototype.sendAddress = function () {
    debug('Send ethereumAddress to ' + this.peerHost + ':' + this.peerPort)
    this._send({
      msg_type: MessageType.SendAddress,
      ethereumAddress: this.ethereumAddress
    })
  }

  return mc_payment_handshake
}
