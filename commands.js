'use strict'

const fs = require('fs')
const path = require('path')
const homedir = require('homedir')
const commander = require('commander')
const machinomy = require('./index')
const buy = require('./commands/buy')
const pry = require('./commands/pry')
const channels = require('./commands/channels')
const close = require('./commands/close')
const configuration = require('./commands/configuration')
const setup = require('./commands/setup')

const BASE_DIR = '.machinomy'
const COFNGIRATION_FILE = 'config.json'

const baseDirPath = function () {
  return path.resolve(path.join(homedir(), BASE_DIR))
}

const ensureBaseDirPresent = function () {
  if (!fs.existsSync(baseDirPath())) {
    fs.mkdir(baseDirPath())
  }
}

const canCreateDatabase = function () {
  try {
    fs.accessSync(baseDirPath(), fs.constants.R_OK | fs.constants.W_OK)
    return true
  } catch (ex) {
    return false
  }
}

const configFilePath = function () {
  return path.join(baseDirPath(), COFNGIRATION_FILE)
}

const canReadConfig = function () {
  try {
    fs.accessSync(configFilePath(), fs.constants.R_OK)
    return true
  } catch (ex) {
    return false
  }
}

/**
 * @returns {object}
 */
const configurationOptions = function () {
  return JSON.parse(fs.readFileSync(configFilePath(), 'utf8'))
}

const canParseConfig = function () {
  try {
    configurationOptions()
    return true
  } catch (ex) {
    return false
  }
}

const ensure = function (command) {
  return function () {
    ensureBaseDirPresent()

    if (!canCreateDatabase()) {
      console.error('Can not create database file in ' + baseDirPath() + '. Please, check if one can create a file there.')
    } else if (!canReadConfig()) {
      console.error('Can not read configuration file. Please, check if it exists, or run `machinomy setup` command for an initial configuration')
    } else if (!canParseConfig()) {
      console.error('Can not parse configuration file. Please, ')
    } else {
      command.apply(null, arguments)
    }
  }
}

const main = function (args) {
  let version = machinomy.NAME + ' v' + machinomy.VERSION
  let parser = commander
    .version(version)
    .option('-P, --password [password]', 'password to unlock the account')

  parser.command('buy <uri>')
    .description('buy a resource at <uri>')
    .action(ensure(buy))

  parser.command('pry <uri>')
    .description('see cost of a resource at <uri>')
    .action(ensure(pry))

  parser.command('channels')
    .option('-n, --namespace [value]', 'find channels under namespace [sender]')
    .description('show open/closed channels')
    .action(ensure(channels))

  parser.command('close <channelId>')
    .option('-n, --namespace [value]', 'find channels under namespace [sender]')
    .description('close the channel')
    .action(ensure(close))

  parser.command('configuration')
    .alias('config')
    .option('-n, --namespace [value]', 'use snamespace [sender]')
    .description('display configuration')
    .action(ensure(configuration))

  parser.command('setup')
    .description('initial setup')
    .option('-n, --namespace [value]', 'use namespace [sender]')
    .action(setup)

  parser.parse(args)
}

module.exports = {
  main: main
}
