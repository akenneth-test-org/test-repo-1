/**
 * AI-powered label to field mapper
 * Uses LLM to intelligently map labels to issue field values
 * Mockable and testable with structured responses
 */

export class AIMapper {
  constructor(llmProvider = null) {
    this.llmProvider = llmProvider || new DefaultLLMProvider();
  }

  /**
   * Generate mappings using AI
   */
  async generateMappings(analysis) {
    const { structuredLabels, availableFields, labelGroups } = analysis;

    if (structuredLabels.length === 0 || availableFields.length === 0) {
      return {};
    }

    // Prepare context for the LLM
    const context = this.prepareContext(structuredLabels, availableFields, labelGroups);

    // Call LLM to generate mappings
    const llmResponse = await this.llmProvider.generateMappings(context);

    // Validate and structure the response
    return this.validateMappings(llmResponse, analysis);
  }

  /**
   * Ask AI to refine mappings based on user feedback
   */
  async refineMappings(currentMappings, userFeedback, analysis) {
    const context = {
      currentMappings,
      userFeedback,
      availableFields: analysis.availableFields,
      structuredLabels: analysis.structuredLabels
    };

    const llmResponse = await this.llmProvider.refineMappings(context);
    return this.validateMappings(llmResponse, analysis);
  }

  /**
   * Prepare context for LLM
   */
  prepareContext(labels, fields, labelGroups) {
    // Group labels by pattern for context
    const labelsByPattern = {};
    Object.entries(labelGroups).forEach(([pattern, groupLabels]) => {
      labelsByPattern[pattern] = groupLabels.map(l => ({
        name: l.name,
        description: l.description,
        color: l.color
      }));
    });

    // Prepare field information
    const fieldInfo = fields
      .filter(f => f.data_type === 'single_select') // Only single_select for now
      .map(f => ({
        name: f.name,
        description: f.description,
        dataType: f.data_type,
        options: f.options?.map(opt => ({
          name: opt.name,
          description: opt.description,
          priority: opt.priority
        })) || []
      }));

    return {
      labels: labelsByPattern,
      fields: fieldInfo,
      allLabels: labels.map(l => l.name)
    };
  }

  /**
   * Validate LLM response and ensure it matches available fields
   */
  validateMappings(llmResponse, analysis) {
    const validated = {};

    for (const [fieldName, mappings] of Object.entries(llmResponse)) {
      // Find the field
      const field = analysis.availableFields.find(f => f.name === fieldName);
      if (!field) {
        console.warn(`Field "${fieldName}" not found, skipping`);
        continue;
      }

      // Validate each mapping
      validated[fieldName] = {};
      for (const [labelName, fieldValue] of Object.entries(mappings)) {
        // Check label exists
        const label = analysis.structuredLabels.find(l => l.name === labelName);
        if (!label) {
          console.warn(`Label "${labelName}" not found, skipping`);
          continue;
        }

        // Check field value exists as an option
        const option = field.options?.find(opt => opt.name === fieldValue);
        if (!option && field.data_type === 'single_select') {
          console.warn(`Field value "${fieldValue}" not found in ${fieldName}, skipping`);
          continue;
        }

        validated[fieldName][labelName] = fieldValue;
      }
    }

    return validated;
  }
}

/**
 * Default LLM Provider interface
 * Can be mocked for testing
 */
export class DefaultLLMProvider {
  async generateMappings(context) {
    // This would call OpenAI, Anthropic, or GitHub Copilot's LLM
    throw new Error('LLM Provider not configured. Please provide a custom provider.');
  }

  async refineMappings(context) {
    throw new Error('LLM Provider not configured. Please provide a custom provider.');
  }
}

/**
 * OpenAI-based LLM Provider
 */
export class OpenAIProvider {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.model = options.model || 'gpt-4';
    this.baseURL = options.baseURL || 'https://api.openai.com/v1';
  }

  async generateMappings(context) {
    const prompt = this.buildMappingPrompt(context);

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at mapping GitHub issue labels to structured issue fields. Respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  }

  async refineMappings(context) {
    const prompt = this.buildRefinementPrompt(context);

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at mapping GitHub issue labels to structured issue fields. Respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  }

  buildMappingPrompt(context) {
    return `You are helping migrate GitHub issue labels to structured issue fields.

**Available Issue Fields:**
${JSON.stringify(context.fields, null, 2)}

**Repository Labels (grouped by pattern):**
${JSON.stringify(context.labels, null, 2)}

**Task:**
Analyze the labels and create intelligent mappings to the available fields.

**Rules:**
1. Map labels to the most semantically appropriate field
2. Match label values to field options based on meaning, not just text
3. For priority/severity labels: map numbers/levels appropriately (1=highest, larger numbers=lower)
4. Consider color meanings (red=high priority, green=low priority, etc.)
5. Only map labels that clearly belong to a structured field
6. Don't map generic labels like "bug", "feature", "documentation"

**Response Format (JSON only):**
{
  "FieldName": {
    "label-name": "FieldValue",
    "another-label": "AnotherValue"
  }
}

**Example:**
If there are labels "priority-1", "priority-2" and a Priority field with options P0, P1, P2:
{
  "Priority": {
    "priority-1": "P1",
    "priority-2": "P2"
  }
}

Generate the mappings:`;
  }

  buildRefinementPrompt(context) {
    return `You are helping refine GitHub issue label to field mappings based on user feedback.

**Current Mappings:**
${JSON.stringify(context.currentMappings, null, 2)}

**Available Fields:**
${JSON.stringify(context.availableFields.map(f => ({
  name: f.name,
  description: f.description,
  options: f.options?.map(o => o.name)
})), null, 2)}

**Available Labels:**
${context.structuredLabels.map(l => l.name).join(', ')}

**User Feedback:**
"${context.userFeedback}"

**Task:**
Update the mappings based on the user's feedback. The user might:
- Want to change which field a label maps to
- Want to change which value a label maps to
- Want to add new mappings
- Want to remove mappings
- Want to exclude certain labels

Parse the natural language feedback and update the mappings accordingly.

**Response Format (JSON only):**
{
  "FieldName": {
    "label-name": "FieldValue"
  }
}

Generate the updated mappings:`;
  }
}

/**
 * GitHub Copilot LLM Provider (uses GitHub Copilot Chat API)
 */
export class GitHubCopilotProvider {
  constructor(githubToken, options = {}) {
    this.githubToken = githubToken;
    this.model = options.model || 'gpt-4o';
    this.customPrompt = options.customPrompt || '';
    this.octokit = options.octokit;
  }

  async generateMappings(context) {
    const prompt = this.buildMappingPrompt(context);

    const requestBody = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at mapping GitHub issue labels to structured issue fields. Respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      stream: false
    };

    const response = await fetch('https://api.githubcopilot.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.githubToken}`,
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.1',
        'User-Agent': 'GitHubCopilotChat/0.11.1'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub Copilot API error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error('Could not parse JSON from Copilot response');
  }

  async refineMappings(context) {
    const prompt = this.buildRefinementPrompt(context);

    const requestBody = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at mapping GitHub issue labels to structured issue fields. Respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      stream: false
    };

    const response = await fetch('https://api.githubcopilot.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.githubToken}`,
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.1',
        'User-Agent': 'GitHubCopilotChat/0.11.1'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub Copilot API error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error('Could not parse JSON from Copilot response');
  }

  buildMappingPrompt(context) {
    let prompt = `You are helping migrate GitHub issue labels to structured issue fields.

**Available Issue Fields:**
${JSON.stringify(context.fields, null, 2)}

**Repository Labels (grouped by pattern):**
${JSON.stringify(context.labels, null, 2)}

**Task:**
Analyze the labels and create intelligent mappings to the available fields.`;

    if (this.customPrompt) {
      prompt += `\n\n**User Instructions:**\n${this.customPrompt}`;
    }

    prompt += `

**Rules:**
1. Map labels to the most semantically appropriate field
2. Match label values to field options based on meaning, not just text
3. For priority/severity labels: map numbers/levels appropriately (1=highest, larger numbers=lower)
4. Consider color meanings (red=high priority, green=low priority, etc.)
5. Only map labels that clearly belong to a structured field
6. Don't map generic labels like "bug", "feature", "documentation"
7. Follow any user instructions provided above

**Response Format (JSON only):**
{
  "FieldName": {
    "label-name": "FieldValue",
    "another-label": "AnotherValue"
  }
}

**Example:**
If there are labels "priority-1", "priority-2" and a Priority field with options P0, P1, P2:
{
  "Priority": {
    "priority-1": "P1",
    "priority-2": "P2"
  }
}

Generate the mappings:`;
    return prompt;
  }

  buildRefinementPrompt(context) {
    return `You are helping refine GitHub issue label to field mappings based on user feedback.

**Current Mappings:**
${JSON.stringify(context.currentMappings, null, 2)}

**Available Fields:**
${JSON.stringify(context.availableFields.map(f => ({
  name: f.name,
  description: f.description,
  options: f.options?.map(o => o.name)
})), null, 2)}

**Available Labels:**
${context.structuredLabels.map(l => l.name).join(', ')}

**User Feedback:**
"${context.userFeedback}"

**Task:**
Update the mappings based on the user's feedback. The user might:
- Want to change which field a label maps to
- Want to change which value a label maps to
- Want to add new mappings
- Want to remove mappings
- Want to exclude certain labels

Parse the natural language feedback and update the mappings accordingly.

**Response Format (JSON only):**
{
  "FieldName": {
    "label-name": "FieldValue"
  }
}

Generate the updated mappings:`;
  }
}

/**
 * Mock LLM Provider for testing
 */
export class MockLLMProvider {
  constructor(mockResponses = {}) {
    this.mockResponses = mockResponses;
    this.callHistory = [];
  }

  async generateMappings(context) {
    this.callHistory.push({ type: 'generateMappings', context });
    
    if (this.mockResponses.generateMappings) {
      return this.mockResponses.generateMappings;
    }

    // Default mock response
    return {
      "Priority": {
        "priority-1": "P1",
        "priority-2": "P2",
        "p1": "P1"
      }
    };
  }

  async refineMappings(context) {
    this.callHistory.push({ type: 'refineMappings', context });
    
    if (this.mockResponses.refineMappings) {
      return this.mockResponses.refineMappings;
    }

    // Return current mappings unchanged by default
    return context.currentMappings;
  }

  getCallHistory() {
    return this.callHistory;
  }

  reset() {
    this.callHistory = [];
  }
}
