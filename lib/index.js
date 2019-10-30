const CronJob = require('cron').CronJob
const moment = require('moment')
const { isString } = require('lodash')

const Job = require('./database/job')

const NO_PERSISTANCE = 'NO_PERSISTANCE'
const jobs = {}

/**
 * Plugin factory
 * @param {Object}   koa
 * @param {Object}   utils      - Aido utils which can be used by the plugin
 * @param {Function} utils.emitSlash
 * @param {Function} utils.emitAction
 */
function pluginFactory(koa, utils) {
  /**
   * Schedule a slash or an action at a CRON time
   * @param {Job}           persistedJob
   * @param {String|Object} cronTime
   */
  async function setCronJob(persistedJob, cronTime) {
    const { id, user, slash, text, action, args, channel, conversationWith, conversationAs } = persistedJob
    // Schedule the job
    const job = new CronJob(cronTime, async function() {
      console.log(`⏲️ Executing job ${id} : @${user} / ${slash} / ${text || action}`)
      try {
        if (action) {
          await utils.emitAction(user, slash, action, args, {
            channel,
            conversationWith,
            conversationAs,
          })
        } else {
          await utils.emitSlash(user, slash, text, {
            channel,
            conversationWith,
            conversationAs,
          })
        }
        if (job.runOnce && id !== NO_PERSISTANCE) {
          await persistedJob.$query().patch({ done: true })
        }
      } catch(error) {
        console.log(error)
        if (id !== NO_PERSISTANCE) {
          await persistedJob.$query().patch({ done: false, error: error.toString() })
        }
      }
    }, null, true, 'UTC');
    job.start()

    // Store in memory and return the id
    jobs[id] = job
    return id
  }

  /**
   * Schedule a slash or an action at a CRON time
   * @param {Object}      database
   * @param {String|Date} cronTime - can be a cron-job type string or a javascript date
   * @param {String}      user
   * @param {String}      slash
   * @param {String}      text
   * @param {String}      action
   * @param {Object}      args
   * @param {Object}      options
   * @param {String}      options.channel
   * @param {String[]}    options.conversationWith
   * @param {String}      options.conversationAs
   * @param {String}       options.sessionId
   */
  async function scheduleTask(database, cronTime, user, slash, text, action, args, options) {
    const persistedJob = await database.Job.query().insert({
      cron: isString(cronTime) ? cronTime : moment(cronTime).toISOString(),
      user,
      slash,
      text,
      action,
      args,
      channel: options.channel,
      conversationWith: options.conversationWith,
      conversationAs: options.conversationAs,
      sessionId: this.sessionId,
    })

    return setCronJob(persistedJob, cronTime)
  }

  /**
   * Kill jobs by ids or with search params
   * @param {Object}   args
   * @param {Number}   args.id    - use to fetch the job by its id
   * @param {String}   args.user  - or search the job(s) using its parameters
   * @param {String}   args.slash
   * @param {String}   args.action
   * @param {String[]} args.conversationWith
   * @param {String}   args.conversationAs
   * @param {String}   [message]
   */
  async function killTasks(database, {
    id = null,
    user = null,
    slash = null,
    action = null,
    conversationWith = null,
    conversationAs = 'bot',
  }, message = 'Killed by Aido command') {
    if (id) {
      await cancelCronJob(database, id, message)
    } else {
      const persistedJobs = await database.Job.query()
      .whereNull('done')                             // Can only kill a task that is not done yet
      .andWhere('cron', '>=', moment().toISOString()) // and that is scheduled in the future
      .andWhere({
        ...user && { user },
        ...slash && { slash },
        ...action && { action },
        ...conversationAs && { conversationAs },
      })
      .modify((queryBuilder) => {
        if (conversationWith) {
          queryBuilder.whereRaw('??::text = ?', ['conversationWith', JSON.stringify(conversationWith)])
        }
      })
      await Promise.all(persistedJobs.map(job => cancelCronJob(database, job.id, message)))
    }
  }

  /**
   * Cancels a job in the scheduler and removes it from memory
   * @param {Object} database
   * @param {Number} id
   * @param {String} message
   */
  async function cancelCronJob(database, id, message) {
    // Stop job in the scheduler & remove from memory
    const job = jobs[id]
    job.stop()
    delete jobs[id]

    // Cancel the job in DB
    const persistedJob = await database.Job.query().findById(id)
    await persistedJob.$query().patch({ done: false, error: message })
  }

  function slashFactory(oldSlash) {
    class Slash extends oldSlash {
      /**
       * Schedule a slash or an action at a CRON time
       * @param {String|Date}  cronTime - can be a cron-job type string or a javascript date
       * @param {String?}      user
       * @param {String?}      slash
       * @param {String?}      text
       * @param {String?}      action
       * @param {Object?}      args
       * @param {Object}       options
       * @param {String}       options.channel
       * @param {String[]}     options.conversationWith
       * @param {String}       options.conversationAs
       * @param {String}       options.sessionId
       */
      async scheduleTask(cronTime, user, slash, text, action, args = {}, options) {
        return scheduleTask(
          this.database, cronTime,
          user || this.user.slackId,
          slash || this.command,
          text || this.text,
          action || this.action,
          args,
          options || {
            ...this.channel && { channel: this.channel },
            ...this.conversationWith && { conversationWith: this.conversationWith },
            ...this.conversationAs && { conversationAs: this.conversationAs },
            ...this.sessionId && { sessionId: this.sessionId },
          }
        )
      }
  
      /**
       * Kill jobs by ids or with search params
       * @param {Object}   args
       * @param {Number}   args.id    - use to fetch the job by its id
       * @param {String}   args.user  - or search the job(s) using its parameters
       * @param {String}   args.slash
       * @param {String}   args.action
       * @param {String[]} args.conversationWith
       * @param {String}   args.conversationAs
       * @param {String}   [message]
       */
      async killTasks({
        id = null,
        user = null,
        slash = null,
        action = null,
        conversationWith = null,
        conversationAs = 'bot',
      }, message = 'Killed by Aido command') {
        return killTasks(this.database, {
          id, user, slash, action, conversationWith, conversationAs
        }, message)
      }
    }

    return Slash
  }

  /**
   * Add plugin specific tables to the DB
   * @param {Object}      database
   */
  async function extendDb(database) {
    const { createTable } = database
    await createTable('job', (table) => {
      table.increments('id').primary()
      table.string('cron')
      table.string('user')
      table.string('slash')
      table.string('text')
      table.string('action')
      table.string('channel')
      table.json('conversationWith')
      table.string('conversationAs')
      table.json('args')
      table.boolean('done')
      table.string('error')
    })

    database.Job = Job
  }

  /**
   * Initializes the plugin : get all jobs in the database and re-schedule them
   * @param {Object}   database
   */
  async function initPlugin(database) {
    const jobs = await database.Job.query().whereNull('done')
    jobs.forEach(job => {
      console.log(`⏲️ Requeuing job ${job.id}`)
      let cronTime
      // Identifies the kind of cron Time being used
      if (moment(job.cron).isValid()) {
        if (moment(job.cron).isBefore(moment())) {
          // If the cronTime is a date in the past, fix the job by setting it 1 minute in the future
          cronTime = moment().add(1, 'second')
        } else {
          // If the cronTime is a date in the future, get it as a moment
          cronTime = moment(job.cron)
        }
      } else {
        // If the cronTime is not a valid moment, then it's a CRON string
        cronTime = job.cron
      }
      setCronJob(job, cronTime)
    })
  }

  /**
   * Get the helpers which will be accessible in the aido object
   * @param {Object}   database
   */
  function getHelpers(database) {
    return {
        /**
       * Schedule a slash or an action at a CRON time
       * @param {any} args - see above for signature
       */
      async scheduleTask(cronTime, ...args) {
        return scheduleTask(database, cronTime, ...args)
      },

      /**
       * Sets a CRON Job with no persistence (won't be replicated at each startup)
       * @param {String|Date} cronTime - can be a cron-job type string or a javascript date
       * @param {String}      user
       * @param {String}      slash
       * @param {String}      text
       * @param {String}      action
       * @param {Object}      args
       * @param {String}      channel
       * @param {String[]}    conversationWith
       * @param {String}      conversationAs
       */
      async setCronJob(cronTime, user, slash, text, action, args, channel, conversationWith, conversationAs) {
        const persistedJob = { id: NO_PERSISTANCE, user, slash, text, action, args, channel, conversationWith, conversationAs }
        setCronJob(persistedJob, cronTime)
      },

      /**
       * Kill jobs by ids or with search params
       * @param {Object}   args
       * @param {Number}   args.id    - use to fetch the job by its id
       * @param {String}   args.user  - or search the job(s) using its parameters
       * @param {String}   args.slash
       * @param {String}   args.action
       * @param {String[]} args.conversationWith
       * @param {String}   args.conversationAs
       * @param {String}   [message]
       */
      async killTasks({
        id = null,
        user = null,
        slash = null,
        action = null,
        conversationWith = null,
        conversationAs = 'bot',
      }, message = 'Killed by Aido command') {
        return killTasks(database, {
          id, user, slash, action, conversationWith, conversationAs
        }, message)
      }
    }
  }

  return {
    name: 'cron',
    slashFactory,
    extendDb,
    initPlugin,
    getHelpers,
  }
}

module.exports = pluginFactory
