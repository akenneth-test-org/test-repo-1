/**
 * Agent wrapper for GitHub Copilot Extension
 * Handles the Copilot Extension protocol and state management
 */

export class Agent {
  constructor(config) {
    this.name = config.name;
    this.description = config.description;
    this.version = config.version;
    this.commands = new Map();
    this.messageHandler = null;
    this.state = new Map(); // In-memory state (use Redis/DB in production)
  }

  /**
   * Register a slash command handler
   */
  registerCommand(command, handler) {
    this.commands.set(command, handler);
  }

  /**
   * Register a message handler for conversation flow
   */
  registerMessageHandler(handler) {
    this.messageHandler = handler;
  }

  /**
   * Start the agent server
   */
  async start() {
    // In a real Copilot Extension, this would:
    // 1. Set up an HTTP server to receive webhook events from GitHub
    // 2. Authenticate requests using the GitHub App credentials
    // 3. Handle the Copilot Extension protocol
    
    console.log(`${this.name} v${this.version} started`);
    console.log(`Available commands: ${Array.from(this.commands.keys()).join(', ')}`);
    
    // For development/testing, we'll export functions that can be called directly
    return this;
  }

  /**
   * Create context object for handlers
   */
  createContext(payload) {
    const { installation, repository, copilot } = payload;
    
    return {
      owner: repository.owner.login,
      repo: repository.name,
      conversationId: copilot.conversation_id,
      octokit: this.createOctokit(installation.access_token),
      
      sendMessage: async (message) => {
        // In production, this would send via Copilot Extension API
        console.log('[Agent]:', message);
        return message;
      },
      
      setState: (id, data) => {
        this.state.set(id, data);
      },
      
      getState: (id) => {
        return this.state.get(id);
      },
      
      clearState: (id) => {
        this.state.delete(id);
      }
    };
  }

  /**
   * Create authenticated Octokit instance
   */
  createOctokit(token) {
    const { Octokit } = require('@octokit/rest');
    return new Octokit({ auth: token });
  }
}
