#!/usr/bin/env node

/**
 * Issue Fields Migrator - GitHub Copilot Extension
 * 
 * Main agent that handles the interactive migration flow from labels to issue fields.
 */

import { Octokit } from '@octokit/rest';
import { Agent } from './agent.js';
import { LabelAnalyzer } from './label-analyzer.js';
import { FieldMapper } from './field-mapper.js';
import { AIMapper } from './ai-mapper.js';
import { MigrationExecutor } from './migration-executor.js';

/**
 * Main entry point for the Copilot Extension agent
 */
async function main() {
  const agent = new Agent({
    name: 'issue-fields-migrator',
    description: 'Helps migrate repository labels to GitHub Issue Fields',
    version: '1.0.0'
  });

  // Register the main command handler
  agent.registerCommand('migrate-labels', async (context) => {
    const { octokit, owner, repo, conversationId } = context;
    
    try {
      // Step 1: Analyze labels and fields
      await context.sendMessage('🔍 Analyzing repository labels and organization issue fields...');
      
      const analyzer = new LabelAnalyzer(octokit, owner, repo);
      const analysis = await analyzer.analyze();
      
      if (analysis.structuredLabels.length === 0) {
        return await context.sendMessage(
          '✅ No structured labels detected. Your repository doesn\'t appear to use labels for field-like data.\n\n' +
          'Structured labels typically follow patterns like:\n' +
          '- `priority-1`, `priority-2`\n' +
          '- `impact:high`, `impact:low`\n' +
          '- `size/small`, `size/large`'
        );
      }

      // Step 2: Generate initial mappings using AI
      await context.sendMessage(
        `Found **${analysis.structuredLabels.length} structured labels** that could map to issue fields.\n\n` +
        `📋 Available issue fields in your organization: ${analysis.availableFields.map(f => f.name).join(', ')}\n\n` +
        '🤖 Using AI to analyze labels and generate intelligent mappings...'
      );

      // Use AI mapper (with fallback to rule-based if no LLM provider)
      const aiMapper = context.aiMapper || new AIMapper();
      let proposedMappings;
      
      try {
        proposedMappings = await aiMapper.generateMappings(analysis);
      } catch (error) {
        // Fallback to rule-based mapper if AI fails
        console.warn('AI mapping failed, falling back to rule-based:', error.message);
        await context.sendMessage('⚠️ AI mapping unavailable, using rule-based mapping...');
        const fallbackMapper = new FieldMapper(analysis);
        proposedMappings = await fallbackMapper.generateMappings();
      }

      // Step 3: Present mappings for review
      const mappingSummary = formatMappingSummary(proposedMappings, analysis);
      await context.sendMessage(
        '## 📊 Proposed Label → Field Mappings\n\n' +
        mappingSummary +
        '\n\n**What would you like to do?**\n' +
        '1. ✅ Accept these mappings and preview changes\n' +
        '2. ✏️ Modify mappings (tell me which labels to map differently)\n' +
        '3. ❌ Cancel migration'
      );

      // Store state for conversation continuity
      context.setState(conversationId, {
        step: 'review_mappings',
        analysis,
        proposedMappings
      });

    } catch (error) {
      await context.sendMessage(`❌ Error: ${error.message}`);
      throw error;
    }
  });

  // Handle follow-up responses in the conversation
  agent.registerMessageHandler(async (context) => {
    const { message, conversationId } = context;
    const state = context.getState(conversationId);

    if (!state) {
      return; // Not in an active migration flow
    }

    const { step, analysis, proposedMappings } = state;

    if (step === 'review_mappings') {
      return await handleMappingReview(context, message, analysis, proposedMappings);
    } else if (step === 'preview_changes') {
      return await handlePreviewResponse(context, message, state);
    }
  });

  // Start the agent server
  await agent.start();
  console.log('✅ Issue Fields Migrator agent is running');
}

/**
 * Handle user response to proposed mappings
 */
async function handleMappingReview(context, message, analysis, proposedMappings) {
  const { octokit, owner, repo, conversationId } = context;
  const lowerMessage = message.toLowerCase();

  // User wants to modify mappings
  if (lowerMessage.includes('modify') || lowerMessage.includes('change') || lowerMessage.includes('different')) {
    await context.sendMessage(
      'Please tell me which labels you\'d like to map differently.\n\n' +
      'For example:\n' +
      '- "Map priority-1, priority-2 to Priority field"\n' +
      '- "Don\'t migrate size/* labels"\n' +
      '- "Map bug, feature to Issue Type field"'
    );
    return;
  }

  // User wants to cancel
  if (lowerMessage.includes('cancel') || lowerMessage.includes('stop')) {
    context.clearState(conversationId);
    await context.sendMessage('❌ Migration cancelled. No changes were made.');
    return;
  }

  // User accepts - move to preview
  if (lowerMessage.includes('accept') || lowerMessage.includes('preview') || lowerMessage.includes('yes')) {
    await context.sendMessage('🔍 Analyzing affected issues...');

    const executor = new MigrationExecutor(octokit, owner, repo);
    const preview = await executor.preview(proposedMappings);

    const previewSummary = formatPreviewSummary(preview);
    await context.sendMessage(
      '## 📋 Migration Preview\n\n' +
      previewSummary +
      '\n\n⚠️ **This will modify ' + preview.totalIssues + ' issues**\n\n' +
      '**Ready to execute?**\n' +
      '- Type **"execute migration"** to proceed\n' +
      '- Type **"cancel"** to abort\n\n' +
      '*(The original labels will remain on issues after migration)*'
    );

    context.setState(conversationId, {
      step: 'preview_changes',
      analysis,
      proposedMappings,
      preview
    });
    return;
  }

  // User provides feedback for mapping changes
  // Use AI to refine mappings based on natural language feedback
  await context.sendMessage('🤖 Understanding your feedback and updating mappings...');
  
  const aiMapper = context.aiMapper || new AIMapper();
  let updatedMappings;
  
  try {
    updatedMappings = await aiMapper.refineMappings(proposedMappings, message, analysis);
  } catch (error) {
    // Fallback to manual parsing if AI fails
    console.warn('AI refinement failed, using manual parsing:', error.message);
    const customMappings = await parseCustomMappings(message, analysis);
    if (customMappings) {
      const mapper = new FieldMapper(analysis);
      updatedMappings = await mapper.applyCustomMappings(proposedMappings, customMappings);
    } else {
      await context.sendMessage(
        '❌ I couldn\'t understand your request. Please try:\n' +
        '- "Map priority-critical to P0"\n' +
        '- "Change priority-1 to map to P0 instead of P1"\n' +
        '- "Don\'t migrate high-priority labels"\n' +
        'Or type "accept" to proceed with current mappings.'
      );
      return;
    }
  }

  const mappingSummary = formatMappingSummary(updatedMappings, analysis);
  await context.sendMessage(
    '## 📊 Updated Mappings\n\n' +
    mappingSummary +
    '\n\n**What would you like to do?**\n' +
    '1. ✅ Accept these mappings and preview changes\n' +
    '2. ✏️ Make more changes (tell me what to adjust)\n' +
    '3. ❌ Cancel migration'
  );

  context.setState(conversationId, {
    step: 'review_mappings',
    analysis,
    proposedMappings: updatedMappings
  });
}

/**
 * Handle user response to migration preview
 */
async function handlePreviewResponse(context, message, state) {
  const { octokit, owner, repo, conversationId } = context;
  const { proposedMappings, preview } = state;
  const lowerMessage = message.toLowerCase();

  // User explicitly confirms execution
  if (lowerMessage.includes('execute migration') || lowerMessage === 'execute') {
    await context.sendMessage('🚀 Starting migration... This may take a few minutes.');

    const executor = new MigrationExecutor(octokit, owner, repo);
    const result = await executor.execute(proposedMappings);

    await context.sendMessage(
      '## ✅ Migration Complete!\n\n' +
      `- **${result.successCount}** issues updated successfully\n` +
      `- **${result.failureCount}** issues failed (check logs)\n` +
      `- **${result.skippedCount}** issues skipped\n\n` +
      '### What Changed\n' +
      formatResultSummary(result) +
      '\n\n🎉 Your labels have been migrated to issue fields!'
    );

    context.clearState(conversationId);
    return;
  }

  // User cancels
  if (lowerMessage.includes('cancel') || lowerMessage.includes('stop')) {
    context.clearState(conversationId);
    await context.sendMessage('❌ Migration cancelled. No changes were made.');
    return;
  }

  // Unclear response
  await context.sendMessage(
    '⚠️ Please explicitly type **"execute migration"** to proceed, or **"cancel"** to abort.\n\n' +
    'This ensures you understand that ' + preview.totalIssues + ' issues will be modified.'
  );
}

/**
 * Format mapping summary for display
 */
function formatMappingSummary(mappings, analysis) {
  let summary = '';
  
  for (const [fieldName, mapping] of Object.entries(mappings)) {
    const field = analysis.availableFields.find(f => f.name === fieldName);
    summary += `### ${fieldName}\n`;
    summary += `*${field.description}*\n\n`;
    
    for (const [labelPattern, fieldValue] of Object.entries(mapping)) {
      const matchingLabels = analysis.structuredLabels.filter(l => 
        l.name.match(new RegExp(labelPattern))
      );
      summary += `- \`${labelPattern}\` → **${fieldValue}** (${matchingLabels.length} labels)\n`;
    }
    summary += '\n';
  }

  const unmappedLabels = analysis.structuredLabels.filter(label => {
    return !Object.values(mappings).some(mapping => 
      Object.keys(mapping).some(pattern => label.name.match(new RegExp(pattern)))
    );
  });

  if (unmappedLabels.length > 0) {
    summary += `### ⚠️ Unmapped Labels (${unmappedLabels.length})\n`;
    summary += 'These labels won\'t be migrated:\n';
    summary += unmappedLabels.map(l => `- \`${l.name}\``).join('\n');
    summary += '\n';
  }

  return summary;
}

/**
 * Format preview summary for display
 */
function formatPreviewSummary(preview) {
  let summary = `**Total Issues to Update:** ${preview.totalIssues}\n\n`;
  
  for (const [fieldName, changes] of Object.entries(preview.byField)) {
    summary += `### ${fieldName}\n`;
    for (const [value, count] of Object.entries(changes)) {
      summary += `- ${count} issues → **${value}**\n`;
    }
    summary += '\n';
  }

  if (preview.examples.length > 0) {
    summary += '### Example Issues\n';
    for (const example of preview.examples.slice(0, 5)) {
      summary += `- #${example.number}: ${example.title}\n`;
      summary += `  - Labels: ${example.labels.join(', ')}\n`;
      summary += `  - Will set: ${formatFieldChanges(example.changes)}\n`;
    }
  }

  return summary;
}

/**
 * Format field changes for display
 */
function formatFieldChanges(changes) {
  return Object.entries(changes)
    .map(([field, value]) => `${field}=${value}`)
    .join(', ');
}

/**
 * Format result summary for display
 */
function formatResultSummary(result) {
  let summary = '';
  
  for (const [fieldName, count] of Object.entries(result.byField)) {
    summary += `- **${fieldName}**: ${count} issues\n`;
  }

  return summary;
}

/**
 * Parse custom mapping instructions from user message
 */
async function parseCustomMappings(message, analysis) {
  // This is a simplified parser - in production, you'd use more sophisticated NLP
  // or leverage Copilot's own understanding
  
  const mappingRegex = /map\s+(.+?)\s+to\s+(.+?)(?:\s+field)?$/i;
  const match = message.match(mappingRegex);
  
  if (match) {
    const labels = match[1].split(',').map(l => l.trim());
    const fieldName = match[2].trim();
    
    return {
      labels,
      fieldName
    };
  }
  
  return null;
}

// Start the agent
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };
