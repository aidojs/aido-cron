# aido-cron

A plugin to add cron-like capabilities to Aido applications.

Aido-cron allows you to setup slashes and actions to be executed in the future, using either **CRON job syntax**, a javascript Date object or a [moment](https://momentjs.com/). Your scheduled tasks are stored in your application's database and will persist across reboots.

## Installation

The aido-cron package can be installed with your package manager of choice :

```sh
npm install --save aido-cron
# or
yarn add aido-cron
```

To use it in your Aido application, you'll need to import it as a plugin :

```javascript
const aidoCron = require('aido-cron')

aido.init({
  plugins: [aidoCron],
})
```

*Important caveat*
> Aido-cron does not require any additional configuration, however it will create a new `job` table in your database. It is required that you use a database with **JSON columns** support.

## Usage

You can schedule a task to be executed once at a given time, or repeatedly using CRON syntax.
(*Please note that `node-cron`, which is used under the hood, has a specific CRON syntax with an additional field for seconds. You can refer to [node-cron's documentation](https://www.npmjs.com/package/cron) for a complete view*)

```javascript
const moment = require('moment')
const { Slash } = require('/aido')

class MySlash extends Slash {
  // ...
  /**
   * Schedule a slash 10 minutes from now
   * (this is equivalent to the user typing `/fnord some text` in Slack)
   */
  simpleSlashWithText() {
    const in10Minutes = moment().add(10, 'minutes')
    this.scheduleTask(in10Minutes, this.user.slackId, 'fnord', 'some text')
  }
  /**
   * Schedule an action 10 minutes from now
   * (this is equivalent to the user clicking a button or submitting a dialog in your `fnord` application)
   */
  simpleAction() {
    const in10Minutes = moment().add(10, 'minutes')
    this.scheduleTask(in10Minutes, this.user.slackId, 'fnord', '', 'someAction')
  }
  /**
   * Schedule a slash every 10 minutes
   * (this is probably a bad idea, see the "Using CRON syntax" section :p)
   */
  simpleAction() {
    this.scheduleTask('0 */10 * * * *', this.user.slackId, 'fnord')
  }
  // ...
}
```

## Use cases

The above examples only cover using aido-cron inside of your Slash classes, to respond to a user's interaction. However, the methods are also exposed in the aido `helpers` under the `cron` namespace, allowing for more use cases.

### Inside a plugin

Your aido plugin can use the helpers exposed by aido-cron. You just need to load your plugin after aido-cron.

```javascript
function pluginFactory(koa, utils) {
  async function initPlugin() {
    // Sets the command to be executed 10 minutes after the plugin initializes
    const in10Minutes = moment().add(10, 'minutes')
    utils.helpers.cron.scheduleTask(in10Minutes, this.user.slackId, 'fnord')
  }
}
```

### On application startup

In this example, we will schedule a task to be executed 10 minutes after application startup, without user intervention.

```javascript

aido.init({ ... })

aido.start().then(() => {
  const in10Minutes = moment().add(10, 'minutes')
  aido.helpers.cron.scheduleTask(in10Minutes, this.user.slackId, 'fnord')
})
```

### Using CRON syntax

Because CRON jobs are persisted to the database, it is not advised to create tasks using CRON syntax on application startup.

```javascript
aido.start().then(() => {
  // BAD : Creates the job and stores it in the database to persist across reboots
  aido.helpers.cron.scheduleTask('0 */10 * * * *', this.user.slackId, 'fnord')
  // This is bad because a new job will be created at each reboot and they will pile up
  // GOOD : You should rather use
  aido.helpers.cron.setCronJob('0 */10 * * * *', this.user.slackId, 'fnord')
  // which queues the CRON job but does not store it in the database
})
```

### Killing a scheduled task

Each job is assigned an ID, which you can store and use later to cancel it. You can also kill batches of jobs which fit certain criteria.

```javascript

const { Slash } = require('/aido')

class MySlash extends Slash {
// ...
  /**
   * Starts executing every 10 minutes
   */
  start() {
    this.state.jobId = this.scheduleTask('0 */10 * * * *', this.user.slackId, 'fnord')
  }
  /**
   * Stops the execution
   */
  stop() {
    this.killTasks({ id: this.state.jobId }, 'Job was killed')
  }
  /**
   * Stops the execution for all cron jobs for this user
   */
  stopAll() {
    this.killTasks({ user: this.user.slackId }, 'Entire batch of jobs was killed')
  }
// ...
}
```

## API

### scheduleTask(cronTime, user, slash, text, action, args, options)

Queues a job and stores it in the database to persist across reboots.

*If not otherwise specified, the parameters all default to those of the current context (user, slash, action, etc...).*

* **cronTime** (*String|Date|Moment*) : The time to fire off your task. Can be a CRON-like string, a Date, or a [Moment](https://momentjs.com/). See [node-cron documentation](https://www.npmjs.com/package/cron)
* **user** (*String*) : the recipient's Slack ID
* **slash** (*String*) : the slash to execute. This is the equivalent to the user typing `/your_slash`
* **text** (*String*) : the text of the slash. This is the equivalent to the user typing `/your_slash some text`
* **action** (*String*) : the action to execute. This is the equivalent to the user clicking a button in one of your views
* **args** (*Object*) : an arbitrary payload to deliver to the action. This is the equivalent to the data received when a user submits a Dialog. Defaults to `{}`
* **options** (*Object*) : transport options to deliver the message. Defaults to the current transport options
  * **options.channel** (*String*) : the channel on which to post the command
  * **options.conversationWith** (*String[]*) : an array of Slack IDs for multiparty conversations. This will create a channel with the bot, the original user, and all the users specified here.
  * **options.conversationAs** (*String*) : can be `bot` or `user`. For multiparty conversations, this specifies if the app should post as the bot user, or as the admin who installed the application. Please note that posting as a bot user requires a bot token and the relevant OAuth scopes.
  * **options.sessionId** (*String*) : the unique ID of an existing session with the recipient user

### killTasks(options, message)

Kills a job or a batch or jobs, storing the message in the jobs database.

* **options** (*Object*) : The method of identifying the job
  * **options.id** (*Number*) : The exact id of the job. Ignores all other options and kills this job only
  * **options.user** (*String*) : Search for jobs for this user
  * **options.slash** (*String*) : Search for jobs by Slash command
  * **options.action** (*String*) : Search for jobs by action
  * **options.conversationWith** (*String[]*) : An array of Slack IDs. Search for jobs with these participants
  * **options.conversationAs** (*String*) : can be `bot` or `user`
* **message** (*String*) : This message will be stored in the `error` column of the killed job(s)

### setCronJob(cronTime, user, slash, text, action, args, channel, conversationWith, conversationAs)

Only available from the plugin helpers, under the `cron` namespace. Queues a job without storing it in the database. See scheduleTask for detailed usage.
