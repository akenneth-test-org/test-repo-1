/**
 * Maps detected label patterns to available issue fields
 * Uses intelligent heuristics and allows for custom mappings
 */

export class FieldMapper {
  constructor(analysis) {
    this.analysis = analysis;
  }

  /**
   * Generate intelligent mappings from labels to fields
   */
  async generateMappings() {
    const mappings = {};
    
    // Map each label group to the most appropriate field
    for (const [pattern, labels] of Object.entries(this.analysis.labelGroups)) {
      const field = this.findMatchingField(pattern, labels);
      
      if (field) {
        mappings[field.name] = this.createFieldMapping(labels, field);
      }
    }
    
    return mappings;
  }

  /**
   * Find the best matching issue field for a label pattern
   */
  findMatchingField(pattern, labels) {
    const { availableFields } = this.analysis;
    
    // Direct name matches
    const directMatch = availableFields.find(field => 
      field.name.toLowerCase() === pattern.toLowerCase()
    );
    if (directMatch) return directMatch;
    
    // Pattern-based matching
    const patternMappings = {
      'priority': ['Priority', 'Pri'],
      'pri': ['Priority'],
      'p': ['Priority'],
      'impact': ['Impact', 'Severity'],
      'severity': ['Impact', 'Severity'],
      'size': ['Effort', 'Size'],
      'effort': ['Effort', 'Size'],
      'type': ['Issue Type', 'Type'],
      'status': ['Status', 'State']
    };
    
    const possibleFields = patternMappings[pattern.toLowerCase()] || [];
    
    for (const fieldName of possibleFields) {
      const field = availableFields.find(f => 
        f.name.toLowerCase() === fieldName.toLowerCase()
      );
      if (field) return field;
    }
    
    // Fuzzy matching based on label values
    return this.fuzzyMatchField(labels, availableFields);
  }

  /**
   * Fuzzy match labels to fields based on their values
   */
  fuzzyMatchField(labels, availableFields) {
    // Extract values from labels (the part after the separator)
    const labelValues = labels.map(l => this.extractValue(l.name));
    
    // Find field with options that best match the label values
    for (const field of availableFields) {
      if (field.data_type !== 'single_select') continue;
      
      const options = field.options || [];
      const optionNames = options.map(o => o.name.toLowerCase());
      
      // Count how many label values match field options
      const matchCount = labelValues.filter(value => 
        optionNames.some(option => 
          this.fuzzyEquals(value, option)
        )
      ).length;
      
      // If more than 50% of labels match, consider it a good match
      if (matchCount / labels.length > 0.5) {
        return field;
      }
    }
    
    return null;
  }

  /**
   * Extract the value portion from a label name
   */
  extractValue(labelName) {
    // Extract value after delimiter
    const match = labelName.match(/[-_:\/](.+)$/);
    if (match) {
      return match[1].toLowerCase();
    }
    
    // Extract value before delimiter (for reverse patterns)
    const prefixMatch = labelName.match(/^(.+)[-_:\/]/);
    if (prefixMatch) {
      return prefixMatch[1].toLowerCase();
    }
    
    return labelName.toLowerCase();
  }

  /**
   * Fuzzy string equality check
   */
  fuzzyEquals(str1, str2) {
    const s1 = str1.toLowerCase().replace(/[-_\s]/g, '');
    const s2 = str2.toLowerCase().replace(/[-_\s]/g, '');
    
    // Exact match
    if (s1 === s2) return true;
    
    // Substring match
    if (s1.includes(s2) || s2.includes(s1)) return true;
    
    // Priority number mapping (p1 -> P1, priority-1 -> P1)
    const num1 = str1.match(/\d+/)?.[0];
    const num2 = str2.match(/\d+/)?.[0];
    if (num1 && num2 && num1 === num2) return true;
    
    return false;
  }

  /**
   * Create mapping from labels to field values
   */
  createFieldMapping(labels, field) {
    const mapping = {};
    
    for (const label of labels) {
      const value = this.extractValue(label.name);
      const fieldOption = this.findMatchingOption(value, field);
      
      if (fieldOption) {
        // Use exact label name as key (not a flexible regex pattern)
        // This ensures priority-1 and priority-2 map to different values
        mapping[label.name] = fieldOption.name;
      }
    }
    
    return mapping;
  }

  /**
   * Find the matching field option for a label value
   */
  findMatchingOption(value, field) {
    const options = field.options || [];
    
    // Try exact match first
    let match = options.find(opt => 
      this.fuzzyEquals(value, opt.name)
    );
    
    if (match) return match;
    
    // Try description match
    match = options.find(opt => 
      opt.description && this.fuzzyEquals(value, opt.description)
    );
    
    return match;
  }

  /**
   * Create a regex pattern to match similar labels
   */
  createLabelPattern(labelName) {
    // Escape special regex characters and keep exact match
    // We don't want priority-1 to match priority-2
    return labelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Apply custom user-specified mappings
   */
  async applyCustomMappings(currentMappings, customMappings) {
    const updated = { ...currentMappings };
    const { labels, fieldName } = customMappings;
    
    // Find the field
    const field = this.analysis.availableFields.find(f => 
      this.fuzzyEquals(f.name, fieldName)
    );
    
    if (!field) {
      throw new Error(`Field "${fieldName}" not found`);
    }
    
    // Create new mapping for these labels
    if (!updated[field.name]) {
      updated[field.name] = {};
    }
    
    for (const labelName of labels) {
      const label = this.analysis.allLabels.find(l => 
        this.fuzzyEquals(l.name, labelName)
      );
      
      if (label) {
        const value = this.extractValue(label.name);
        const fieldOption = this.findMatchingOption(value, field);
        
        if (fieldOption) {
          const pattern = this.createLabelPattern(label.name);
          updated[field.name][pattern] = fieldOption.name;
        }
      }
    }
    
    return updated;
  }
}
