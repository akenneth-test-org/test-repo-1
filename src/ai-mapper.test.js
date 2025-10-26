/**
 * Tests for AI-powered label mapper
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { AIMapper, MockLLMProvider } from './ai-mapper.js';

test('AIMapper generates mappings using LLM', async () => {
  const mockProvider = new MockLLMProvider({
    generateMappings: {
      "Priority": {
        "priority-1": "P1",
        "priority-2": "P2"
      }
    }
  });

  const mapper = new AIMapper(mockProvider);

  const analysis = {
    structuredLabels: [
      { name: 'priority-1', color: 'd73a4a' },
      { name: 'priority-2', color: 'fbca04' }
    ],
    availableFields: [
      {
        name: 'Priority',
        data_type: 'single_select',
        options: [
          { name: 'P1', priority: 1 },
          { name: 'P2', priority: 2 }
        ]
      }
    ],
    labelGroups: {
      priority: [
        { name: 'priority-1', color: 'd73a4a' },
        { name: 'priority-2', color: 'fbca04' }
      ]
    }
  };

  const mappings = await mapper.generateMappings(analysis);

  assert.deepEqual(mappings, {
    "Priority": {
      "priority-1": "P1",
      "priority-2": "P2"
    }
  });

  // Verify LLM was called
  assert.equal(mockProvider.getCallHistory().length, 1);
  assert.equal(mockProvider.getCallHistory()[0].type, 'generateMappings');
});

test('AIMapper validates mappings against available fields', async () => {
  const mockProvider = new MockLLMProvider({
    generateMappings: {
      "Priority": {
        "priority-1": "P1",
        "invalid-label": "P2"  // This label doesn't exist
      },
      "NonExistentField": {  // This field doesn't exist
        "priority-2": "P2"
      }
    }
  });

  const mapper = new AIMapper(mockProvider);

  const analysis = {
    structuredLabels: [
      { name: 'priority-1', color: 'd73a4a' }
    ],
    availableFields: [
      {
        name: 'Priority',
        data_type: 'single_select',
        options: [
          { name: 'P1', priority: 1 },
          { name: 'P2', priority: 2 }
        ]
      }
    ],
    labelGroups: {
      priority: [{ name: 'priority-1', color: 'd73a4a' }]
    }
  };

  const mappings = await mapper.generateMappings(analysis);

  // Should only include valid mappings
  assert.deepEqual(mappings, {
    "Priority": {
      "priority-1": "P1"
    }
  });
});

test('AIMapper validates field values exist as options', async () => {
  const mockProvider = new MockLLMProvider({
    generateMappings: {
      "Priority": {
        "priority-1": "P1",
        "priority-2": "P9"  // P9 doesn't exist in options
      }
    }
  });

  const mapper = new AIMapper(mockProvider);

  const analysis = {
    structuredLabels: [
      { name: 'priority-1', color: 'd73a4a' },
      { name: 'priority-2', color: 'fbca04' }
    ],
    availableFields: [
      {
        name: 'Priority',
        data_type: 'single_select',
        options: [
          { name: 'P1', priority: 1 },
          { name: 'P2', priority: 2 }
        ]
      }
    ],
    labelGroups: {
      priority: [
        { name: 'priority-1', color: 'd73a4a' },
        { name: 'priority-2', color: 'fbca04' }
      ]
    }
  };

  const mappings = await mapper.generateMappings(analysis);

  // Should only include valid field values
  assert.deepEqual(mappings, {
    "Priority": {
      "priority-1": "P1"
    }
  });
});

test('AIMapper refines mappings based on user feedback', async () => {
  const mockProvider = new MockLLMProvider({
    refineMappings: {
      "Priority": {
        "priority-1": "P0",  // Changed from P1 to P0
        "priority-2": "P2"
      }
    }
  });

  const mapper = new AIMapper(mockProvider);

  const analysis = {
    structuredLabels: [
      { name: 'priority-1', color: 'd73a4a' },
      { name: 'priority-2', color: 'fbca04' }
    ],
    availableFields: [
      {
        name: 'Priority',
        data_type: 'single_select',
        options: [
          { name: 'P0', priority: 0 },
          { name: 'P1', priority: 1 },
          { name: 'P2', priority: 2 }
        ]
      }
    ],
    labelGroups: {}
  };

  const currentMappings = {
    "Priority": {
      "priority-1": "P1",
      "priority-2": "P2"
    }
  };

  const refined = await mapper.refineMappings(
    currentMappings,
    "Map priority-1 to P0 instead",
    analysis
  );

  assert.deepEqual(refined, {
    "Priority": {
      "priority-1": "P0",
      "priority-2": "P2"
    }
  });
});

test('AIMapper prepares context correctly', () => {
  const mapper = new AIMapper(new MockLLMProvider());

  const labels = [
    { name: 'priority-1', color: 'd73a4a', description: 'Critical' },
    { name: 'priority-2', color: 'fbca04', description: 'High' }
  ];

  const fields = [
    {
      name: 'Priority',
      description: 'Issue priority',
      data_type: 'single_select',
      options: [
        { name: 'P1', description: 'Highest', priority: 1 },
        { name: 'P2', description: 'High', priority: 2 }
      ]
    }
  ];

  const labelGroups = {
    priority: labels
  };

  const context = mapper.prepareContext(labels, fields, labelGroups);

  assert.ok(context.labels);
  assert.ok(context.fields);
  assert.ok(context.allLabels);
  assert.equal(context.allLabels.length, 2);
  assert.equal(context.fields.length, 1);
  assert.equal(context.fields[0].name, 'Priority');
});

test('MockLLMProvider tracks call history', async () => {
  const mockProvider = new MockLLMProvider();

  await mockProvider.generateMappings({ labels: [], fields: [] });
  await mockProvider.generateMappings({ labels: [], fields: [] });

  const history = mockProvider.getCallHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].type, 'generateMappings');
  assert.equal(history[1].type, 'generateMappings');

  mockProvider.reset();
  assert.equal(mockProvider.getCallHistory().length, 0);
});
