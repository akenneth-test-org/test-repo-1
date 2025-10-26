/**
 * Executes the migration from labels to issue fields
 * Handles preview and actual migration
 */

export class MigrationExecutor {
  constructor(octokit, owner, repo) {
    this.octokit = octokit;
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Preview the migration without making changes
   */
  async preview(mappings) {
    const affectedIssues = await this.findAffectedIssues(mappings);
    
    const preview = {
      totalIssues: affectedIssues.length,
      byField: {},
      examples: []
    };
    
    for (const issue of affectedIssues) {
      const changes = this.calculateChanges(issue, mappings);
      
      // Count by field
      for (const [fieldName, value] of Object.entries(changes)) {
        if (!preview.byField[fieldName]) {
          preview.byField[fieldName] = {};
        }
        if (!preview.byField[fieldName][value]) {
          preview.byField[fieldName][value] = 0;
        }
        preview.byField[fieldName][value]++;
      }
      
      // Add to examples (first 10)
      if (preview.examples.length < 10) {
        preview.examples.push({
          number: issue.number,
          title: issue.title,
          labels: issue.labels.map(l => l.name),
          changes
        });
      }
    }
    
    return preview;
  }

  /**
   * Execute the actual migration with optional progress callback
   */
  async execute(mappings, options = {}) {
    const { onProgress } = options;
    const affectedIssues = await this.findAffectedIssues(mappings);
    
    const result = {
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
      byField: {},
      errors: []
    };
    
    console.log(`Migrating ${affectedIssues.length} issues...`);
    
    for (let i = 0; i < affectedIssues.length; i++) {
      const issue = affectedIssues[i];
      
      try {
        const changes = this.calculateChanges(issue, mappings);
        
        if (Object.keys(changes).length === 0) {
          result.skippedCount++;
          continue;
        }
        
        await this.applyChanges(issue, changes);
        
        result.successCount++;
        
        // Count by field
        for (const fieldName of Object.keys(changes)) {
          if (!result.byField[fieldName]) {
            result.byField[fieldName] = 0;
          }
          result.byField[fieldName]++;
        }
        
        // Call progress callback
        if (onProgress) {
          await onProgress(i + 1, affectedIssues.length);
        }
        
      } catch (error) {
        result.failureCount++;
        result.errors.push({
          issue: issue.number,
          error: error.message
        });
        console.error(`Failed to migrate issue #${issue.number}:`, error.message);
      }
      
      // Rate limiting - pause every 100 requests
      if ((result.successCount + result.failureCount) % 100 === 0) {
        await this.sleep(1000);
      }
    }
    
    return result;
  }

  /**
   * Find all issues affected by the mappings
   */
  async findAffectedIssues(mappings) {
    // Extract all label patterns we're looking for
    const labelPatterns = [];
    for (const fieldMapping of Object.values(mappings)) {
      labelPatterns.push(...Object.keys(fieldMapping));
    }
    
    // Fetch all issues with these labels
    const issues = [];
    let page = 1;
    
    while (true) {
      const { data } = await this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        state: 'all',
        per_page: 100,
        page
      });
      
      if (data.length === 0) break;
      
      // Filter issues that have matching labels
      const matching = data.filter(issue => {
        return issue.labels.some(label => {
          return labelPatterns.some(pattern => {
            return new RegExp(pattern).test(label.name);
          });
        });
      });
      
      issues.push(...matching);
      page++;
    }
    
    return issues;
  }

  /**
   * Calculate what field changes should be made for an issue
   */
  calculateChanges(issue, mappings) {
    const changes = {};
    
    for (const [fieldName, fieldMapping] of Object.entries(mappings)) {
      for (const [labelPattern, fieldValue] of Object.entries(fieldMapping)) {
        const regex = new RegExp(labelPattern);
        
        // Check if issue has a matching label
        const hasLabel = issue.labels.some(label => regex.test(label.name));
        
        if (hasLabel) {
          changes[fieldName] = fieldValue;
          break; // Only one value per field
        }
      }
    }
    
    return changes;
  }

  /**
   * Apply field changes to an issue
   */
  async applyChanges(issue, changes) {
    // Get the field IDs and option IDs
    const fieldUpdates = [];
    
    for (const [fieldName, fieldValue] of Object.entries(changes)) {
      const field = await this.findField(fieldName);
      if (!field) continue;
      
      const option = field.options?.find(opt => opt.name === fieldValue);
      if (!option) continue;
      
      fieldUpdates.push({
        field_id: field.id,
        value: option.id
      });
    }
    
    // Get issue node ID if not available
    let issueNodeId = issue.node_id;
    if (!issueNodeId) {
      const { data: issueData } = await this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issue.number
      });
      issueNodeId = issueData.node_id;
    }
    
    // Apply all field updates using GraphQL
    for (const update of fieldUpdates) {
      await this.octokit.graphql(`
        mutation UpdateIssueField($issueId: ID!, $fieldId: ID!, $valueId: ID!) {
          updateIssueField(input: {
            issueId: $issueId
            fieldId: $fieldId
            valueId: $valueId
          }) {
            issue {
              id
            }
          }
        }
      `, {
        issueId: issueNodeId,
        fieldId: update.field_id,
        valueId: update.value
      });
    }
  }

  /**
   * Find a field by name (cached)
   */
  async findField(fieldName) {
    if (!this._fieldCache) {
      const { data } = await this.octokit.request('GET /orgs/{org}/issue-fields', {
        org: this.owner
      });
      this._fieldCache = data;
    }
    
    return this._fieldCache.find(f => f.name === fieldName);
  }

  /**
   * Sleep helper for rate limiting
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
