const { Model } = require('objection')

class Job extends Model {
  static get tableName() {
    return 'job'
  }

  static get idColumn() {
    return 'id'
  }

  static get jsonAttributes() {
    return ['conversationWith', 'args']
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['cron', 'user', 'slash'],

      properties: {
        id: { type: 'integer' },
        cron: { type: 'string', minLength: 1, maxLength: 50 },
        user: { type: 'string', minLength: 9, maxLength: 9 },
        slash: { type: 'string', minLength: 1, maxLength: 255 },
        text: { type: 'string' },
        action: { type: 'string', minLength: 1, maxLength: 255 },
        channel: { type: 'string', minLength: 9, maxLength: 9 },
        conversationWith: { type: 'array' },
        conversationAs: { type: 'string', minLength: 3, maxLength: 4 },
        args: { type: 'object' },
        done: { type: 'boolean' },
        error: { type: 'string' },
      },
    }
  }
}

module.exports = Job
