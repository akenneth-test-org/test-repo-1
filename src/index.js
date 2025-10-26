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
import fs from 'fs/promises';

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
        '1. Comment **"@issue-fields-migrator accept"** to preview changes\n' +
        '2. Comment **"@issue-fields-migrator Map <label> to <value> instead"** to modify mappings\n' +
        '3. Comment **"@issue-fields-migrator cancel"** to stop'
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
    } else if (step === 'modify_preview') {
      return await handlePreviewModification(context, message, state);
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
      '**What would you like to do?**\n' +
      '- Comment **"@issue-fields-migrator execute migration"** to proceed\n' +
      '- Comment **"@issue-fields-migrator modify"** to adjust field values for specific issues\n' +
      '- Comment **"@issue-fields-migrator cancel"** to abort\n\n' +
      '*(The original labels will remain on issues after migration)*'
    );

    context.setState(conversationId, {
      step: 'preview_changes',
      analysis,
      proposedMappings,
      preview,
      affectedIssues: preview.affectedIssues
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
    '🤖 Updated mappings based on your feedback:\n\n' +
    '## 📊 Proposed Label → Field Mappings\n\n' +
    mappingSummary +
    '\n\n**What would you like to do?**\n' +
    '1. Comment **"@issue-fields-migrator accept"** to preview changes\n' +
    '2. Comment more feedback to further modify\n' +
    '3. Comment **"@issue-fields-migrator cancel"** to stop'
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
  const { proposedMappings, preview, analysis, affectedIssues } = state;
  const lowerMessage = message.toLowerCase();

  // User explicitly confirms execution
  if (lowerMessage.includes('execute migration') || lowerMessage === 'execute') {
    await context.sendMessage('🚀 Starting migration... This may take a few minutes.');

    const executor = new MigrationExecutor(octokit, owner, repo);
    const result = await executor.execute(proposedMappings, { 
      overrides: state.overrides || {} 
    });

    // Generate detailed results table
    const resultsTable = formatResultsTable(result);
    
    // Save as artifact
    const artifactPath = `.migration-results-${Date.now()}.md`;
    await fs.writeFile(artifactPath, resultsTable);

    await context.sendMessage(
      '## ✅ Migration Complete!\n\n' +
      `- **${result.successCount}** issues updated successfully\n` +
      `- **${result.failureCount}** issues failed\n` +
      `- **${result.skippedCount}** issues skipped\n\n` +
      '### Updated Fields\n' +
      formatResultSummary(result) +
      '\n\n### All Updated Issues\n\n' +
      resultsTable +
      '\n\n' +
      (result.errors.length > 0 ? '### Errors\n' + result.errors.map(e => `- Issue #${e.issue}: ${e.error}`).join('\n') + '\n\n' : '') +
      '🎉 Your labels have been migrated to issue fields!'
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

  // User wants to modify preview
  if (lowerMessage.includes('modify') || lowerMessage.includes('change') || lowerMessage.includes('adjust')) {
    await context.sendMessage(
      '✏️ You can now modify field values for specific issues.\n\n' +
      '**Examples:**\n' +
      '- "Set issue #42 Priority to P0"\n' +
      '- "Change issue #15 Status to In Progress"\n' +
      '- "Don\'t update issue #23"\n' +
      '- "Set issues #10, #11, #12 Priority to Critical"\n\n' +
      'Type **"done"** when finished, or **"back"** to see the preview again.'
    );
    
    context.setState(conversationId, {
      step: 'modify_preview',
      analysis,
      proposedMappings,
      preview,
      affectedIssues,
      overrides: state.overrides || {}
    });
    return;
  }

  // Unclear response
  await context.sendMessage(
    '⚠️ Please choose an option:\n' +
    '- **"@issue-fields-migrator execute migration"** to proceed\n' +
    '- **"@issue-fields-migrator modify"** to adjust field values\n' +
    '- **"@issue-fields-migrator cancel"** to abort\n\n' +
    'This will modify ' + preview.totalIssues + ' issues.'
  );
}

/**
 * Handle user modifications to preview
 */
async function handlePreviewModification(context, message, state) {
  const { conversationId } = context;
  const { proposedMappings, preview, analysis, affectedIssues, overrides } = state;
  const lowerMessage = message.toLowerCase();

  // User is done with modifications
  if (lowerMessage === 'done' || lowerMessage.includes('finished')) {
    // Apply overrides to mappings
    const modifiedMappings = applyOverridesToMappings(proposedMappings, overrides, affectedIssues);
    
    // Regenerate preview with modifications
    await context.sendMessage('🔄 Regenerating preview with your modifications...');
    const executor = new MigrationExecutor(context.octokit, context.owner, context.repo);
    const updatedPreview = await executor.previewWithOverrides(modifiedMappings, overrides);
    
    const previewSummary = formatPreviewSummary(updatedPreview);
    const overridesSummary = formatOverridesSummary(overrides);
    
    await context.sendMessage(
      '## 📋 Updated Migration Preview\n\n' +
      previewSummary +
      '\n\n' +
      (Object.keys(overrides).length > 0 ? '### 🔧 Manual Overrides\n' + overridesSummary + '\n\n' : '') +
      '⚠️ **This will modify ' + updatedPreview.totalIssues + ' issues**\n\n' +
      '**What would you like to do?**\n' +
      '- Comment **"@issue-fields-migrator execute migration"** to proceed\n' +
      '- Comment **"@issue-fields-migrator modify"** to make more changes\n' +
      '- Comment **"@issue-fields-migrator cancel"** to abort'
    );
    
    context.setState(conversationId, {
      step: 'preview_changes',
      analysis,
      proposedMappings: modifiedMappings,
      preview: updatedPreview,
      affectedIssues,
      overrides
    });
    return;
  }

  // User wants to go back to preview
  if (lowerMessage === 'back' || lowerMessage.includes('preview')) {
    const previewSummary = formatPreviewSummary(preview);
    await context.sendMessage(
      '## 📋 Migration Preview\n\n' +
      previewSummary +
      '\n\nComment **"modify"** to make changes again.'
    );
    
    context.setState(conversationId, {
      step: 'preview_changes',
      analysis,
      proposedMappings,
      preview,
      affectedIssues,
      overrides
    });
    return;
  }

  // Parse modification instructions
  const aiMapper = context.aiMapper || new AIMapper();
  let parsedOverride;
  
  try {
    // Try AI parsing first
    parsedOverride = await aiMapper.parsePreviewModification(message, preview, analysis);
  } catch (error) {
    // Fallback to manual parsing
    console.warn('AI parsing failed, using manual:', error.message);
    parsedOverride = await parsePreviewModification(message, affectedIssues, analysis);
  }

  if (!parsedOverride) {
    await context.sendMessage(
      '❌ I couldn\'t understand that modification. Please try:\n' +
      '- "Set issue #42 Priority to P0"\n' +
      '- "Change issue #15 Status to In Progress"\n' +
      '- "Don\'t update issue #23"\n' +
      '- "Set issues #10, #11, #12 Priority to Critical"'
    );
    return;
  }

  // Apply the override
  for (const issueNumber of parsedOverride.issues) {
    if (!overrides[issueNumber]) {
      overrides[issueNumber] = {};
    }
    
    if (parsedOverride.action === 'skip') {
      overrides[issueNumber]._skip = true;
    } else if (parsedOverride.action === 'set') {
      overrides[issueNumber][parsedOverride.fieldName] = parsedOverride.fieldValue;
    }
  }

  // Confirm the modification
  const confirmationMessage = formatModificationConfirmation(parsedOverride);
  await context.sendMessage(
    '✅ ' + confirmationMessage + '\n\n' +
    'Continue making changes, or type **"done"** to review the updated preview.'
  );

  context.setState(conversationId, {
    step: 'modify_preview',
    analysis,
    proposedMappings,
    preview,
    affectedIssues,
    overrides
  });
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
    summary += '### All Issues to be Updated\n\n';
    summary += '| Issue | Title | Labels | Field Changes |\n';
    summary += '|-------|-------|--------|---------------|\n';
    
    for (const example of preview.examples) {
      const issueLink = `#${example.number}`;
      const title = example.title.substring(0, 50) + (example.title.length > 50 ? '...' : '');
      const labels = example.labels.join(', ');
      const changes = formatFieldChanges(example.changes);
      summary += `| ${issueLink} | ${title} | ${labels} | ${changes} |\n`;
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
 * Format detailed results table for all updated issues
 */
function formatResultsTable(result) {
  if (!result.updatedIssues || result.updatedIssues.length === 0) {
    return '*No issues were updated*';
  }

  let table = '| Issue | Title | Fields Updated | Status |\n';
  table += '|-------|-------|----------------|--------|\n';
  
  for (const update of result.updatedIssues) {
    const issueLink = `#${update.number}`;
    const title = update.title.substring(0, 50) + (update.title.length > 50 ? '...' : '');
    const fields = formatFieldChanges(update.changes);
    const status = update.success ? '✅' : '❌';
    table += `| ${issueLink} | ${title} | ${fields} | ${status} |\n`;
  }

  return table;
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

/**
 * Parse preview modification instructions
 */
async function parsePreviewModification(message, affectedIssues, analysis) {
  // Parse "Set issue #42 Priority to P0" or "Don't update issue #23"
  
  // Skip pattern: "Don't update issue #X"
  const skipMatch = message.match(/(?:don'?t|skip)\s+(?:update\s+)?issue\s+#?(\d+(?:,\s*#?\d+)*)/i);
  if (skipMatch) {
    const issueNumbers = skipMatch[1].split(',').map(n => parseInt(n.replace('#', '').trim()));
    return {
      action: 'skip',
      issues: issueNumbers
    };
  }

  // Set pattern: "Set issue #42 Priority to P0" or "Change issue #15 Status to In Progress"
  const setMatch = message.match(/(?:set|change)\s+issue(?:s)?\s+#?(\d+(?:,\s*#?\d+)*)\s+(.+?)\s+to\s+(.+)/i);
  if (setMatch) {
    const issueNumbers = setMatch[1].split(',').map(n => parseInt(n.replace('#', '').trim()));
    const fieldName = setMatch[2].trim();
    const fieldValue = setMatch[3].trim();
    
    // Validate field exists
    const field = analysis.availableFields.find(f => 
      f.name.toLowerCase() === fieldName.toLowerCase()
    );
    
    if (!field) {
      return null;
    }
    
    return {
      action: 'set',
      issues: issueNumbers,
      fieldName: field.name,
      fieldValue
    };
  }

  return null;
}

/**
 * Apply overrides to proposed mappings
 */
function applyOverridesToMappings(mappings, overrides, affectedIssues) {
  // Overrides are applied at execution time, so we return mappings unchanged
  // but store them for later use
  return mappings;
}

/**
 * Format overrides summary
 */
function formatOverridesSummary(overrides) {
  const entries = Object.entries(overrides);
  if (entries.length === 0) return '';

  let summary = '';
  for (const [issueNumber, changes] of entries) {
    if (changes._skip) {
      summary += `- Issue #${issueNumber}: **Skip** (will not be updated)\n`;
    } else {
      const changesList = Object.entries(changes)
        .filter(([k]) => k !== '_skip')
        .map(([field, value]) => `${field}=${value}`)
        .join(', ');
      summary += `- Issue #${issueNumber}: ${changesList}\n`;
    }
  }
  
  return summary;
}

/**
 * Format modification confirmation
 */
function formatModificationConfirmation(parsedOverride) {
  const issueList = parsedOverride.issues.length === 1 
    ? `Issue #${parsedOverride.issues[0]}`
    : `Issues #${parsedOverride.issues.join(', #')}`;

  if (parsedOverride.action === 'skip') {
    return `${issueList} will be skipped.`;
  } else if (parsedOverride.action === 'set') {
    return `${issueList} ${parsedOverride.fieldName} will be set to **${parsedOverride.fieldValue}**.`;
  }
  
  return 'Modification applied.';
}

// Start the agent
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };
