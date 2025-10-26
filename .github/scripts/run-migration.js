#!/usr/bin/env node
/**
 * GitHub Actions script for running migration commands
 * Handles the interactive flow via issue comments
 */

import { Octokit } from '@octokit/rest';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { LabelAnalyzer } from '../../src/label-analyzer.js';
import { AIMapper, MockLLMProvider } from '../../src/ai-mapper.js';
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
      case 'refine':
        result = await refineMappings();
        break;
      case 'preview':
        result = await previewMigration();
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
  
  console.log('🤖 Generating intelligent mappings...');
  
  // Use mock AI for now (can be replaced with real OpenAI)
  const mockProvider = new MockLLMProvider({
    generateMappings: generateDefaultMappings(analysis)
  });
  
  const aiMapper = new AIMapper(mockProvider);
  const mappings = await aiMapper.generateMappings(analysis);
  
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
  message += '1. Comment **"accept"** to preview changes\n';
  message += '2. Comment **"Map high-priority to P1 instead"** to modify mappings\n';
  message += '3. Comment **"cancel"** to stop';
  
  return {
    success: true,
    command: 'analyze',
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
  
  // Use AI to refine based on feedback
  const mockProvider = new MockLLMProvider({
    refineMappings: parseRefinementFeedback(COMMENT_BODY, mappings, analysis)
  });
  
  const aiMapper = new AIMapper(mockProvider);
  const updatedMappings = await aiMapper.refineMappings(mappings, COMMENT_BODY, analysis);
  
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
  message += '1. Comment **"accept"** to preview changes\n';
  message += '2. Comment more feedback to further modify\n';
  message += '3. Comment **"cancel"** to stop';
  
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
    message += '### Example Issues\n';
    preview.examples.slice(0, 5).forEach(ex => {
      message += `- #${ex.number}: ${ex.title}\n`;
      message += `  - Labels: ${ex.labels.join(', ')}\n`;
      const changes = Object.entries(ex.changes).map(([k, v]) => `${k}=${v}`).join(', ');
      message += `  - Will set: ${changes}\n`;
    });
  }
  
  message += `\n⚠️ **This will modify ${preview.totalIssues} issues**\n\n`;
  message += '**Ready to execute?**\n';
  message += '- Comment **"execute migration"** to proceed\n';
  message += '- Comment **"cancel"** to abort\n\n';
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
  
  const { mappings } = state;
  
  const executor = new MigrationExecutor(octokit, owner, repo);
  const result = await executor.execute(mappings);
  
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
  }
  
  if (result.errors.length > 0) {
    message += '\n### Errors\n';
    result.errors.forEach(err => {
      message += `- Issue #${err.issue}: ${err.error}\n`;
    });
  }
  
  message += '\n🎉 Your labels have been migrated to issue fields!';
  
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
