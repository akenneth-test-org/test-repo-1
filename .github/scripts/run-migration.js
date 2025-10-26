#!/usr/bin/env node
/**
 * GitHub Actions script for running migration commands
 * Handles the interactive flow via issue comments
 */

import { Octokit } from '@octokit/rest';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { LabelAnalyzer } from '../../src/label-analyzer.js';
import { MigrationExecutor } from '../../src/migration-executor.js';

const COMMAND = process.env.COMMAND;
const TARGET_REPO = process.env.TARGET_REPO;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const COMMENT_BODY = process.env.COMMENT_BODY;

const [owner, repo] = TARGET_REPO.split('/');

// State file to track conversation
const STATE_FILE = `.migration-state-${ISSUE_NUMBER}.json`;

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

async function main() {
  console.log(`Running command: ${COMMAND}`);
  console.log(`Target repository: ${TARGET_REPO}`);
  console.log(`Issue number: ${ISSUE_NUMBER}`);
  
  let result;
  
  try {
    switch (COMMAND) {
      case 'analyze':
        result = await analyzeLabels();
        break;
      case 'use-mapping':
        result = await useCustomMapping();
        break;
      case 'refine':
        result = await refineMappings();
        break;
      case 'preview':
        result = await previewMigration();
        break;
      case 'modify':
        result = await enterModifyMode();
        break;
      case 'override':
        result = await applyOverride();
        break;
      case 'done':
        result = await reviewUpdatedPreview();
        break;
      case 'execute':
        result = await executeMigration();
        break;
      default:
        throw new Error(`Unknown command: ${COMMAND}`);
    }
    
    // Write result to file for GitHub Actions to read
    writeFileSync('migration-result.json', JSON.stringify(result, null, 2));
    console.log('✅ Command completed successfully');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    const errorResult = {
      success: false,
      message: `❌ Error: ${error.message}`,
      command: COMMAND
    };
    writeFileSync('migration-result.json', JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

async function analyzeLabels() {
  console.log('🔍 Analyzing labels and fields...');
  
  const analyzer = new LabelAnalyzer(octokit, owner, repo);
  const analysis = await analyzer.analyze();
  
  if (analysis.structuredLabels.length === 0) {
    return {
      success: true,
      command: 'analyze',
      message: '✅ No structured labels found in this repository.\n\nStructured labels typically follow patterns like:\n- `priority-1`, `priority-2`\n- `impact:high`, `impact:low`\n- `size/small`, `size/large`'
    };
  }
  
  console.log('🤖 Generating rule-based mappings...');
  
  // Use rule-based mapping (user can override with Copilot-generated mappings)
  const mappings = generateDefaultMappings(analysis);
  
  // Save state for next interaction
  saveState({
    step: 'review_mappings',
    analysis,
    mappings
  });
  
  // Format response
  let message = `🔍 Analyzed **${analysis.allLabels.length}** labels in ${owner}/${repo}\n\n`;
  message += `Found **${analysis.structuredLabels.length} structured labels** that could map to issue fields.\n\n`;
  message += `📋 Available issue fields: ${analysis.availableFields.map(f => f.name).join(', ')}\n\n`;
  message += formatMappingsMessage(mappings, analysis);
  message += '\n**What would you like to do?**\n';
  message += '1. Comment **"@issue-fields-migrator accept"** to preview changes\n';
  message += '2. Comment **"@issue-fields-migrator Map \\<label\\> to \\<value\\> instead"** to modify mappings\n';
  message += '3. Use GitHub Copilot for intelligent mapping:\n';
  message += '   - Go to [github.com/copilot](https://github.com/copilot)\n';
  message += '   - Use the prompt from [COPILOT_PROMPT.md](../blob/main/COPILOT_PROMPT.md)\n';
  message += '   - Comment **"@issue-fields-migrator use mapping"** with the JSON result\n';
  message += '4. Comment **"@issue-fields-migrator cancel"** to stop';
  
  return {
    success: true,
    command: 'analyze',
    message
  };
}

async function useCustomMapping() {
  console.log('📥 Using custom Copilot-generated mapping...');
  
  const state = loadState();
  if (!state || !state.analysis) {
    throw new Error('No active migration found. Start with @issue-fields-migrator analyze');
  }
  
  const { analysis } = state;
  
  // Extract JSON from comment body
  const jsonMatch = COMMENT_BODY.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    return {
      success: false,
      command: 'use-mapping',
      message: '❌ Could not find JSON mapping in your comment.\n\nPlease format it as:\n```json\n{\n  "FieldName": {\n    "label": "value"\n  }\n}\n```'
    };
  }
  
  let mappings;
  try {
    mappings = JSON.parse(jsonMatch[1]);
  } catch (error) {
    return {
      success: false,
      command: 'use-mapping',
      message: `❌ Invalid JSON format: ${error.message}\n\nPlease check your JSON syntax.`
    };
  }
  
  // Validate mappings against available fields
  const availableFieldNames = analysis.availableFields.map(f => f.name);
  const invalidFields = Object.keys(mappings).filter(f => !availableFieldNames.includes(f));
  
  if (invalidFields.length > 0) {
    return {
      success: false,
      command: 'use-mapping',
      message: `❌ Invalid fields: ${invalidFields.join(', ')}\n\nAvailable fields: ${availableFieldNames.join(', ')}`
    };
  }
  
  // Save updated state
  saveState({
    step: 'review_mappings',
    analysis,
    mappings
  });
  
  // Format response
  let message = '✅ Custom Copilot mapping applied!\n\n';
  message += '## 📊 Your Custom Mappings\n\n';
  message += formatMappingsMessage(mappings, analysis);
  message += '\n**What would you like to do?**\n';
  message += '1. Comment **"@issue-fields-migrator accept"** to preview changes\n';
  message += '2. Comment more feedback to further modify\n';
  message += '3. Comment **"@issue-fields-migrator cancel"** to stop';
  
  return {
    success: true,
    command: 'use-mapping',
    message
  };
}

async function refineMappings() {
  console.log('🤖 Refining mappings based on feedback...');
  
  const state = loadState();
  if (!state || !state.mappings) {
    throw new Error('No active migration found. Start with @issue-fields-migrator migrate-labels');
  }
  
  const { analysis, mappings } = state;
  
  // Use rule-based refinement based on user feedback
  const updatedMappings = parseRefinementFeedback(COMMENT_BODY, mappings, analysis);
  
  // Save updated state
  saveState({
    step: 'review_mappings',
    analysis,
    mappings: updatedMappings
  });
  
  // Format response
  let message = '🤖 Updated mappings based on your feedback:\n\n';
  message += formatMappingsMessage(updatedMappings, analysis, mappings);
  message += '\n**What would you like to do?**\n';
  message += '1. Comment **"@issue-fields-migrator accept"** to preview changes\n';
  message += '2. Comment more feedback to further modify\n';
  message += '3. Comment **"@issue-fields-migrator cancel"** to stop';
  
  return {
    success: true,
    command: 'refine',
    message
  };
}

async function previewMigration() {
  console.log('📋 Generating preview...');
  
  const state = loadState();
  if (!state || !state.mappings) {
    throw new Error('No active migration found. Start with @issue-fields-migrator migrate-labels');
  }
  
  const { mappings } = state;
  
  const executor = new MigrationExecutor(octokit, owner, repo);
  const preview = await executor.preview(mappings);
  
  // Save state with preview
  saveState({
    ...state,
    step: 'preview_changes',
    preview
  });
  
  // Format response
  let message = '## 📋 Migration Preview\n\n';
  message += `**Total Issues to Update:** ${preview.totalIssues}\n\n`;
  
  for (const [fieldName, changes] of Object.entries(preview.byField)) {
    message += `### ${fieldName}\n`;
    for (const [value, count] of Object.entries(changes)) {
      message += `- ${count} issues → **${value}**\n`;
    }
    message += '\n';
  }
  
  if (preview.examples.length > 0) {
    message += '### All Issues to be Updated\n\n';
    message += '| Issue | Title | Labels | Field Changes |\n';
    message += '|-------|-------|--------|---------------|\n';
    
    preview.examples.forEach(ex => {
      const issueLink = `#${ex.number}`;
      const title = ex.title.substring(0, 50) + (ex.title.length > 50 ? '...' : '');
      const labels = ex.labels.join(', ');
      const changes = Object.entries(ex.changes).map(([k, v]) => `${k}=${v}`).join(', ');
      message += `| ${issueLink} | ${title} | ${labels} | ${changes} |\n`;
    });
    message += '\n';
  }
  
  message += `\n⚠️ **This will modify ${preview.totalIssues} issues**\n\n`;
  message += '**What would you like to do?**\n';
  message += '- Comment **"@issue-fields-migrator execute migration"** to proceed\n';
  message += '- Comment **"@issue-fields-migrator modify"** to adjust field values for specific issues\n';
  message += '- Comment **"@issue-fields-migrator cancel"** to abort\n\n';
  message += '*(Original labels will remain on issues after migration)*';
  
  return {
    success: true,
    command: 'preview',
    message
  };
}

async function executeMigration() {
  console.log('🚀 Executing migration...');
  
  const state = loadState();
  if (!state || !state.mappings) {
    throw new Error('No active migration found. Start with @issue-fields-migrator migrate-labels');
  }
  
  const { mappings, overrides = {} } = state;
  
  const executor = new MigrationExecutor(octokit, owner, repo);
  const result = await executor.execute(mappings, { overrides });
  
  // Clear state
  clearState();
  
  // Format response
  let message = '## ✅ Migration Complete!\n\n';
  message += `- **${result.successCount}** issues updated successfully\n`;
  message += `- **${result.failureCount}** issues failed\n`;
  message += `- **${result.skippedCount}** issues skipped\n\n`;
  
  if (Object.keys(result.byField).length > 0) {
    message += '### Updated Fields\n';
    for (const [fieldName, count] of Object.entries(result.byField)) {
      message += `- **${fieldName}**: ${count} issues\n`;
    }
    message += '\n';
  }
  
  if (result.updatedIssues && result.updatedIssues.length > 0) {
    message += '### All Updated Issues\n\n';
    message += '| Issue | Title | Fields Updated | Status |\n';
    message += '|-------|-------|----------------|--------|\n';
    
    result.updatedIssues.forEach(update => {
      const issueLink = `#${update.number}`;
      const title = update.title.substring(0, 50) + (update.title.length > 50 ? '...' : '');
      const fields = Object.entries(update.changes).map(([k, v]) => `${k}=${v}`).join(', ');
      const status = update.success ? '✅' : '❌';
      message += `| ${issueLink} | ${title} | ${fields} | ${status} |\n`;
    });
    message += '\n';
  }
  
  if (result.errors.length > 0) {
    message += '### Errors\n';
    result.errors.forEach(err => {
      message += `- Issue #${err.issue}: ${err.error}\n`;
    });
    message += '\n';
  }
  
  message += '🎉 Your labels have been migrated to issue fields!';
  
  return {
    success: true,
    command: 'execute',
    message
  };
}

// Helper functions

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('💾 Saved conversation state');
}

function loadState() {
  if (!existsSync(STATE_FILE)) {
    return null;
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function clearState() {
  if (existsSync(STATE_FILE)) {
    // Don't actually delete, just mark as completed
    const state = loadState();
    state.completed = true;
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
}

function extractCustomPrompt(commentBody) {
  if (!commentBody) return null;
  
  // Look for patterns like "with prompt: ..." or "using instructions: ..."
  const promptPattern = /(?:with prompt|using instructions?|custom prompt):?\s*["']?([^"'\n]+)["']?/i;
  const match = commentBody.match(promptPattern);
  
  if (match) {
    return match[1].trim();
  }
  
  // If the comment contains "analyze" command followed by text, use that as prompt
  const analyzePattern = /@issue-fields-migrator\s+analyze\s+(.+)/i;
  const analyzeMatch = commentBody.match(analyzePattern);
  
  if (analyzeMatch) {
    const rest = analyzeMatch[1].trim();
    // If it's not just a command, treat as custom prompt
    if (rest && !rest.match(/^(accept|cancel|preview|execute)/i)) {
      return rest;
    }
  }
  
  return null;
}

function generateDefaultMappings(analysis) {
  const mappings = {};
  
  // Look for priority field
  const priorityField = analysis.availableFields.find(f => 
    f.name.toLowerCase() === 'priority' && f.data_type === 'single_select'
  );
  
  if (priorityField) {
    const priorityMappings = {};
    
    analysis.structuredLabels.forEach(label => {
      const name = label.name.toLowerCase();
      
      if (name.includes('priority-1') || name === 'p1') {
        priorityMappings[label.name] = 'P1';
      } else if (name.includes('priority-2') || name === 'p2') {
        priorityMappings[label.name] = 'P2';
      } else if (name.includes('priority-3') || name === 'p3') {
        priorityMappings[label.name] = 'P3';
      } else if (name.includes('high-priority') || name.includes('critical')) {
        priorityMappings[label.name] = 'P0';
      } else if (name.includes('medium-priority')) {
        priorityMappings[label.name] = 'P2';
      } else if (name.includes('low-priority')) {
        priorityMappings[label.name] = 'P3';
      }
    });
    
    if (Object.keys(priorityMappings).length > 0) {
      mappings[priorityField.name] = priorityMappings;
    }
  }
  
  return mappings;
}

function parseRefinementFeedback(feedback, currentMappings, analysis) {
  // Simple parser for "Map X to Y" patterns
  const mapPattern = /map\s+([^\s]+)\s+to\s+([^\s]+)/i;
  const match = feedback.match(mapPattern);
  
  if (match) {
    const label = match[1];
    const value = match[2];
    
    // Find which field this label belongs to
    for (const [fieldName, mappings] of Object.entries(currentMappings)) {
      if (mappings[label]) {
        const updatedMappings = { ...currentMappings };
        updatedMappings[fieldName] = {
          ...mappings,
          [label]: value
        };
        return updatedMappings;
      }
    }
  }
  
  // If we can't parse, return current mappings
  return currentMappings;
}

async function enterModifyMode() {
  console.log('Entering modification mode...');
  
  const state = loadState();
  if (!state.preview) {
    throw new Error('No preview available. Please run preview first.');
  }
  
  const message = '✏️ You can now modify field values for specific issues.\n\n' +
    '**Examples:**\n' +
    '- "Set issue #42 Priority to P0"\n' +
    '- "Change issue #15 Status to In Progress"\n' +
    '- "Don\'t update issue #23"\n' +
    '- "Set issues #10, #11, #12 Priority to Critical"\n\n' +
    'Type **"@issue-fields-migrator done"** when finished, or **"@issue-fields-migrator back"** to see the preview again.';
  
  // Update state
  state.step = 'modify_preview';
  state.overrides = state.overrides || {};
  saveState(state);
  
  return {
    success: true,
    command: 'modify',
    message
  };
}

async function applyOverride() {
  console.log('Applying override...');
  
  const state = loadState();
  if (state.step !== 'modify_preview') {
    throw new Error('Not in modification mode. Type "modify" first.');
  }
  
  // Parse the override command
  const parsed = parsePreviewModification(COMMENT_BODY, state.preview.affectedIssues, state.analysis);
  
  if (!parsed) {
    return {
      success: false,
      message: '❌ I couldn\'t understand that modification. Please try:\n' +
        '- "Set issue #42 Priority to P0"\n' +
        '- "Don\'t update issue #23"\n' +
        '- "Set issues #10, #11, #12 Priority to Critical"'
    };
  }
  
  // Apply the override
  for (const issueNumber of parsed.issues) {
    if (!state.overrides[issueNumber]) {
      state.overrides[issueNumber] = {};
    }
    
    if (parsed.action === 'skip') {
      state.overrides[issueNumber]._skip = true;
    } else if (parsed.action === 'set') {
      state.overrides[issueNumber][parsed.fieldName] = parsed.fieldValue;
    }
  }
  
  saveState(state);
  
  // Format confirmation
  const issueList = parsed.issues.length === 1 
    ? `Issue #${parsed.issues[0]}`
    : `Issues #${parsed.issues.join(', #')}`;
  
  let confirmMessage;
  if (parsed.action === 'skip') {
    confirmMessage = `✅ ${issueList} will be skipped.`;
  } else if (parsed.action === 'set') {
    confirmMessage = `✅ ${issueList} ${parsed.fieldName} will be set to **${parsed.fieldValue}**.`;
  }
  
  confirmMessage += '\n\nContinue making changes, or type **"@issue-fields-migrator done"** to review the updated preview.';
  
  return {
    success: true,
    command: 'override',
    message: confirmMessage
  };
}

async function reviewUpdatedPreview() {
  console.log('Reviewing updated preview...');
  
  const state = loadState();
  if (!state.preview || !state.mappings) {
    throw new Error('No preview available.');
  }
  
  // Regenerate preview with overrides
  const executor = new MigrationExecutor(octokit, owner, repo);
  const updatedPreview = await executor.previewWithOverrides(state.mappings, state.overrides || {});
  
  // Format message
  let message = '## 📋 Updated Migration Preview\n\n';
  message += `**Total Issues to Update:** ${updatedPreview.totalIssues} *(was ${state.preview.totalIssues})*\n\n`;
  
  // By field
  for (const [field, values] of Object.entries(updatedPreview.byField)) {
    message += `### ${field}\n`;
    for (const [value, count] of Object.entries(values)) {
      message += `- ${count} issues → **${value}**\n`;
    }
    message += '\n';
  }
  
  // Overrides summary
  if (state.overrides && Object.keys(state.overrides).length > 0) {
    message += '### 🔧 Manual Overrides\n';
    for (const [issueNumber, changes] of Object.entries(state.overrides)) {
      if (changes._skip) {
        message += `- Issue #${issueNumber}: **Skip** (will not be updated)\n`;
      } else {
        const changesList = Object.entries(changes)
          .filter(([k]) => k !== '_skip')
          .map(([field, value]) => `${field}=${value}`)
          .join(', ');
        message += `- Issue #${issueNumber}: ${changesList}\n`;
      }
    }
    message += '\n';
  }
  
  message += `\n⚠️ **This will modify ${updatedPreview.totalIssues} issues**\n\n`;
  message += '**What would you like to do?**\n';
  message += '- Comment **"@issue-fields-migrator execute migration"** to proceed\n';
  message += '- Comment **"@issue-fields-migrator modify"** to make more changes\n';
  message += '- Comment **"@issue-fields-migrator cancel"** to abort';
  
  // Update state
  state.preview = updatedPreview;
  state.step = 'preview_changes';
  saveState(state);
  
  return {
    success: true,
    command: 'done',
    message
  };
}

function parsePreviewModification(message, affectedIssues, analysis) {
  // Skip pattern
  const skipMatch = message.match(/(?:don'?t|skip)\s+(?:update\s+)?issue\s+#?(\d+(?:,\s*#?\d+)*)/i);
  if (skipMatch) {
    const issueNumbers = skipMatch[1].split(',').map(n => parseInt(n.replace('#', '').trim()));
    return {
      action: 'skip',
      issues: issueNumbers
    };
  }

  // Set pattern
  const setMatch = message.match(/(?:set|change)\s+issue(?:s)?\s+#?(\d+(?:,\s*#?\d+)*)\s+(.+?)\s+to\s+(.+)/i);
  if (setMatch) {
    const issueNumbers = setMatch[1].split(',').map(n => parseInt(n.replace('#', '').trim()));
    const fieldName = setMatch[2].trim();
    const fieldValue = setMatch[3].trim();
    
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

function formatMappingsMessage(mappings, analysis, previousMappings = null) {
  let message = '## 📊 Proposed Label → Field Mappings\n\n';
  
  for (const [fieldName, fieldMappings] of Object.entries(mappings)) {
    const field = analysis.availableFields.find(f => f.name === fieldName);
    message += `### ${fieldName}\n`;
    if (field?.description) {
      message += `*${field.description}*\n\n`;
    }
    
    for (const [label, value] of Object.entries(fieldMappings)) {
      const changed = previousMappings && 
                     previousMappings[fieldName]?.[label] !== value;
      message += `- \`${label}\` → **${value}**${changed ? ' *(CHANGED)*' : ''}\n`;
    }
    message += '\n';
  }
  
  return message;
}

main();
