'use strict'

const channel = require('./channel')
const log = require('./log')
const Promise = require('bluebird')
const _ = require('lodash')
const Datastore = require('nedb')

class Storage {
  /**
   * @param {Web3} web3
   * @param {string} path
   * @param {string} namespace
   * @param {boolean} inMemoryOnly
   */
  constructor (web3, path, namespace, inMemoryOnly) {
    let storageEngine = engine(path, inMemoryOnly)
    this.namespace = namespace
    this.db = storageEngine.datastore

    /**
     * @type {ChannelsDatabase}
     */
    this.channels = channels(web3, storageEngine, namespace)

    /**
     * @type {TokensDatabase}
     */
    this.tokens = tokens(storageEngine, namespace)

    /**
     * @type {PaymentsDatabase}
     */
    this.payments = payments(storageEngine, namespace)
  }
}

/**
 * @param {Engine} engine
 * @param {string|null} namespace
 * @return {PaymentsDatabase}
 */
const payments = (engine, namespace = null) => {
  return new PaymentsDatabase(engine, namespace)
}

/**
 * Database layer for payments.
 */
class PaymentsDatabase {
  /**
   * @param {Engine} engine
   * @param {string|null} namespace
   */
  constructor (engine, namespace) {
    this.kind = namespaced(namespace, 'payment')
    this.engine = engine
  }

  /**
   * Save payment to the database, to check later.
   * @param {string} token
   * @param {Payment} payment
   * @return {Promise}
   */
  save (token, payment) {
    let document = {
      kind: this.kind,
      token: token,
      channelId: payment.channelId,
      value: payment.value,
      sender: payment.sender,
      receiver: payment.receiver,
      price: payment.price,
      channelValue: payment.channelValue,
      v: Number(payment.v),
      r: payment.r,
      s: payment.s
    }
    log.info(`Saving payment for channel ${payment.channelId} and token ${token}`)
    return this.engine.insert(document)
  }

  /**
   * Find a payment with maximum value on it inside the channel.
   *
   * @param {ChannelId} channelId
   * @returns {Promise<Payment>}
   */
  firstMaximum (channelId) {
    log.info(`Trying to find last payment for channel ${channelId.toString()}`)
    let query = { kind: this.kind, channelId: channelId.toString() }
    return this.engine.find(query).then(documents => {
      log.info(`Found ${documents.length} payment documents`)
      let maximum = _.maxBy(documents, payment => { return payment.value })
      log.info(`Found maximum payment for channel ${channelId}`, maximum)
      return maximum
    })
  }
}

/**
 * @param {Engine} engine
 * @param {string|null} namespace
 * @return {TokensDatabase}
 */
const tokens = (engine, namespace = null) => {
  return new TokensDatabase(engine, namespace)
}

/**
 * Database layer for tokens.
 */
class TokensDatabase {
  /**
   * @param {Engine} engine
   * @param {string|null} namespace
   */
  constructor (engine, namespace = null) {
    this.kind = namespaced(namespace, 'token')
    this.engine = engine
  }

  /**
   * Save token for channelId
   * @param {string} token
   * @param {ChannelId} channelId
   * @return {Promise}
   */
  save (token, channelId) {
    let tokenDocument = {
      kind: this.kind,
      token: token.toString(),
      channelId: channelId.toString()
    }
    return this.engine.insert(tokenDocument)
  }

  /**
   * Check if token is stored.
   *
   * @param {string} token
   * @return {Promise<boolean>}
   */
  isPresent (token) {
    let query = { kind: this.kind, token: token }
    return this.engine.findOne(query).then(document => {
      let result = Boolean(document)
      log.info(`Token ${token} is present: ${result}`)
      return result
    })
  }
}

/**
 * @param {Web3} web3
 * @param {Engine} engine
 * @param {string|null} namespace
 * @return {ChannelsDatabase}
 */
const channels = (web3, engine, namespace = null) => {
  return new ChannelsDatabase(web3, engine, namespace)
}

/**
 * Database layer for {PaymentChannel}
 */
class ChannelsDatabase {

  /**
   * @param {Web3} web3
   * @param {Engine} engine
   * @param {string|null} namespace
   */
  constructor (web3, engine, namespace) {
    this.web3 = web3
    this.kind = namespaced(namespace, 'channel')
    this.engine = engine
  }

  /**
   * @param {PaymentChannel} paymentChannel
   * @return {Promise}
   */
  save (paymentChannel) {
    let document = {
      kind: this.kind,
      sender: paymentChannel.sender,
      receiver: paymentChannel.receiver,
      value: paymentChannel.value,
      spent: paymentChannel.spent,
      channelId: paymentChannel.channelId
    }
    return this.engine.insert(document)
  }

  /**
   * @param {PaymentChannel} paymentChannel
   * @return {Promise}
   */
  saveOrUpdate (paymentChannel) {
    return this.firstById(paymentChannel.channelId).then(found => {
      let result = null
      if (found) {
        result = this.spend(paymentChannel.channelId, paymentChannel.spent)
      } else {
        result = this.save(paymentChannel)
      }
      return result
    })
  }

  /**
   * @param {ChannelId|string} channelId
   * @return {Promise<PaymentChannel>}
   */
  firstById (channelId) {
    let query = {
      kind: this.kind,
      channelId: channelId.toString()
    }
    log.info(`ChannelsDatabase#findById Trying to find channel by id ${channelId.toString()}`)
    return this.engine.findOne(query).then(document => {
      let result = null
      if (document) {
        log.info(`ChannelsDatabase#findById Found document`, document)
        result = channel.contract(this.web3).getState(channelId.toString()).then(state => { // FIXME
          return new channel.PaymentChannel(document.sender, document.receiver, document.channelId, document.value, document.spent, state)
        })
      } else {
        log.info(`ChannelsDatabase#findById Could not find document by id ${channelId.toString()}`)
      }
      return result
    })
  }

  /**
   * Set amount of money spent on the channel.
   *
   * @param {ChannelId} channelId
   * @param spent
   * @return {*}
   */
  spend (channelId, spent) {
    let query = {
      kind: this.kind,
      channelId: channelId.toString()
    }
    let update = {
      $set: {
        spent: spent
      }
    }
    log.info(`ChannelsDatabase#spend channel ${channelId.toString()} spent ${spent}`)
    return this.engine.update(query, update)
  }

  /**
   * Retrieve all the payment channels stored.
   *
   * @return {Promise<PaymentChannel>}
   */
  all () {
    return this.allByQuery({})
  }

  /**
   * Find all channels by query, for example, by sender and receiver.
   * @param {object} q
   * @return {Promise<PaymentChannel>}
   */
  allByQuery (q) {
    let query = Object.assign({kind: this.kind}, q)
    log.info('ChannelsDatabase#allByQuery', query)
    let contract = channel.contract(this.web3)
    return Promise.map(this.engine.find(query), doc => {
      return contract.getState(doc.channelId.toString()).then(state => {
        return new channel.PaymentChannel(doc.sender, doc.receiver, doc.channelId, doc.value, doc.spent, state)
      })
    })
    /*
    return this.engine.find(query).then(found => {
      return _.map(found, doc => {
        let state = contract.getState(doc.channelId.toString()) // FIXME
        return new channel.PaymentChannel(doc.sender, doc.receiver, doc.channelId, doc.value, doc.spent, state)
      })
    })
    */
  }
}

/**
 * Instantiate a storage engine.
 *
 * @param {string} path
 * @param {boolean|null} inMemoryOnly
 * @return {Engine}
 */
const engine = (path, inMemoryOnly = false) => {
  return new Engine(path, inMemoryOnly)
}

/**
 * Database engine.
 *
 * @param {string} path
 * @param {boolean|null} inMemoryOnly
 * @constructor
 */
class Engine {
  constructor (path, inMemoryOnly) {
    // noinspection JSCheckFunctionSignatures
    this.datastore = new Datastore({ filename: path, autoload: true, inMemoryOnly: inMemoryOnly })
    this._find = Promise.promisify(this.datastore.find, { context: this.datastore })
    this._findOne = Promise.promisify(this.datastore.findOne, { context: this.datastore })
    this._insert = Promise.promisify(this.datastore.insert, { context: this.datastore })
    this._update = Promise.promisify(this.datastore.update, { context: this.datastore })
  }

  find (query) {
    return this._find(query)
  }

  findOne (query) {
    return this._findOne(query)
  }

  insert (document) {
    return this._insert(document)
  }

  update (query, update) {
    return this._update(query, update, {})
  }
}

/**
 * @param {string|null} namespace
 * @param {string} kind
 * @return {string}
 */
const namespaced = (namespace, kind) => {
  let result = kind
  if (namespace) {
    result = namespace + ':' + kind
  }
  return result
}

/**
 * Build an instance of Storage.
 *
 * @param {Web3} web3
 * @param {string} path
 * @param {string|null} namespace
 * @param {boolean} inMemoryOnly
 * @returns {Storage}
 */
const build = (web3, path, namespace = null, inMemoryOnly = false) => {
  return new Storage(web3, path, namespace, inMemoryOnly)
}

module.exports = {
  Storage: Storage,
  channels: channels,
  engine: engine,
  tokens: tokens,
  payments: payments,
  build: build
}
