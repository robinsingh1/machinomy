'use strict'

const machinomy = require('../index')

const web3 = machinomy.configuration.web3()

const claim = (storage, contract, paymentChannel) => {
  let channelId = paymentChannel.channelId
  storage.payments.firstMaximum(channelId).then(paymentDoc => {
    let canClaim = contract.canClaim(channelId, paymentDoc.value, Number(paymentDoc.v), paymentDoc.r, paymentDoc.s)
    if (canClaim) {
      contract.claim(paymentChannel.receiver, paymentChannel.channelId, paymentDoc.value, Number(paymentDoc.v), paymentDoc.r, paymentDoc.s).then(value => {
        console.log('Claimed ' + value + ' out of ' + paymentChannel.value + ' from channel ' + channelId)
      }).catch(error => {
        throw error
      })
    } else {
      console.log('Can not claim ' + paymentDoc.value + ' from channel ' + channelId)
    }
  }).catch(error => {
    throw error
  })
}

const startSettle = (settings, contract, paymentChannel) => {
  contract.canStartSettle(settings.account, paymentChannel.channelId).then(canStartSettle => {
    if (canStartSettle) {
      contract.startSettle(settings.account, paymentChannel.channelId, paymentChannel.spent).then(() => {
        console.log('Start settling channel ' + paymentChannel.channelId)
      }).catch(error => {
        throw error
      })
    } else {
      console.log('Can not start settling channel ' + paymentChannel.channelId)
    }
  })
}

const finishSettle = (settings, contract, paymentChannel) => {
  if (contract.canFinishSettle(settings.account, paymentChannel.channelId)) {
    contract.finishSettle(settings.account, paymentChannel.channelId).then(payment => {
      console.log('Settled to pay ' + payment + ' to ' + paymentChannel.receiver)
    }).catch(error => {
      throw error
    })
  } else {
    let until = contract.getUntil(paymentChannel.channelId)
    console.log('Can not finish settle until ' + until)
  }
}

/**
 * @param {String} channelId
 * @param {Object} options
 */
const close = (channelId, options) => {
  let namespace = options.namespace || 'sender'

  let settings = machinomy.configuration[namespace].call()
  let password = options.parent.password || settings.password

  web3.personal.unlockAccount(settings.account, password, 1000)

  let storage = machinomy.storage.build(web3, settings.databaseFile, namespace)
  let contract = machinomy.contract(web3)

  storage.channels.firstById(channelId).then(paymentChannel => {
    contract.getState(channelId).then(state => {
      switch (state) {
        case 0: // open
          console.log('Channel ' + channelId + ' is open')
          if (settings.account === paymentChannel.sender) {
            startSettle(settings, contract, paymentChannel)
          } else if (settings.account === paymentChannel.receiver) {
            claim(storage, contract, paymentChannel)
          }
          break
        case 1: // settling
          console.log('Channel ' + channelId + ' is settling')
          if (settings.account === paymentChannel.sender) {
            finishSettle(settings, contract, paymentChannel)
          } else if (settings.account === paymentChannel.receiver) {
            claim(storage, contract, paymentChannel)
          }
          break
        case 2: // settled, nothing to do
          console.log('Channel ' + channelId + ' is settled')
          break
        default:
          throw new Error('Unsupported channel state: ' + state)
      }
    })
  }).catch(error => {
    throw error
  })
}

module.exports = close
