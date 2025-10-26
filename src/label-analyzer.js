/**
 * Analyzes repository labels to detect structured patterns
 * that could be migrated to issue fields
 */

export class LabelAnalyzer {
  constructor(octokit, owner, repo) {
    this.octokit = octokit;
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Analyze repository labels and organization issue fields
   */
  async analyze() {
    // Fetch all labels from the repository
    const labels = await this.fetchAllLabels();
    
    // Fetch organization issue fields
    const availableFields = await this.fetchIssueFields();
    
    // Detect structured labels
    const structuredLabels = this.detectStructuredLabels(labels);
    
    // Group labels by pattern
    const labelGroups = this.groupLabelsByPattern(structuredLabels);
    
    return {
      allLabels: labels,
      structuredLabels,
      labelGroups,
      availableFields
    };
  }

  /**
   * Fetch all labels from the repository
   */
  async fetchAllLabels() {
    const labels = [];
    let page = 1;
    
    while (true) {
      const { data } = await this.octokit.rest.issues.listLabelsForRepo({
        owner: this.owner,
        repo: this.repo,
        per_page: 100,
        page
      });
      
      if (data.length === 0) break;
      labels.push(...data);
      page++;
    }
    
    return labels;
  }

  /**
   * Fetch organization issue fields
   */
  async fetchIssueFields() {
    try {
      const { data } = await this.octokit.request('GET /orgs/{org}/issue-fields', {
        org: this.owner
      });
      return data;
    } catch (error) {
      console.error('Error fetching issue fields:', error.message);
      return [];
    }
  }

  /**
   * Detect labels that follow structured patterns
   */
  detectStructuredLabels(labels) {
    const patterns = [
      // Priority patterns
      /^(priority|pri|p)[-_:\/]?\d+$/i,
      /^(critical|high|medium|low)[-_]?priority$/i,
      
      // Impact/Severity patterns
      /^(impact|severity)[-_:\/](critical|high|medium|low)$/i,
      /^(critical|high|medium|low)[-_](impact|severity)$/i,
      
      // Size/Effort patterns
      /^(size|effort)[-_:\/](small|medium|large|xl|xxl|\d+)$/i,
      /^(small|medium|large|xl|xxl)[-_](size|effort)$/i,
      
      // Status patterns
      /^(status|state)[-_:\/]\w+$/i,
      
      // Type patterns (but not generic single words)
      /^(type|kind)[-_:\/]\w+$/i,
      
      // Other structured patterns
      /^\w+[-_:\/](high|medium|low|\d+)$/i
    ];
    
    return labels.filter(label => {
      return patterns.some(pattern => pattern.test(label.name));
    });
  }

  /**
   * Group labels by their pattern/prefix
   */
  groupLabelsByPattern(labels) {
    const groups = {};
    
    for (const label of labels) {
      const group = this.extractPattern(label.name);
      
      if (!groups[group]) {
        groups[group] = [];
      }
      
      groups[group].push(label);
    }
    
    return groups;
  }

  /**
   * Extract the pattern/prefix from a label name
   */
  extractPattern(labelName) {
    // Try to extract prefix before delimiter
    const match = labelName.match(/^([^-_:\/]+)[-_:\/]/);
    if (match) {
      return match[1].toLowerCase();
    }
    
    // Try to extract suffix after delimiter
    const suffixMatch = labelName.match(/[-_:\/]([^-_:\/]+)$/);
    if (suffixMatch) {
      const suffix = suffixMatch[1].toLowerCase();
      if (['priority', 'impact', 'severity', 'size', 'effort', 'status'].includes(suffix)) {
        return suffix;
      }
    }
    
    return 'other';
  }
}
