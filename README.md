# Issue Fields Migrator

GitHub Copilot Extension for migrating labels to GitHub Issue Fields.

## Overview

The Issue Fields Migrator helps you transition from using labels for structured data (like priorities, statuses, and sizes) to GitHub's native Issue Fields feature. This provides better organization, filtering, and reporting capabilities for your issues.

## Features

- **Intelligent Label Analysis**: Automatically detects labels that follow structured patterns (e.g., `priority-1`, `status:in-progress`, `size/large`)
- **AI-Powered Mapping**: Uses AI to generate smart mappings from labels to issue fields based on semantic meaning
- **Interactive Migration**: Preview changes before applying them, with the ability to modify mappings
- **Bulk Updates**: Efficiently migrate hundreds of issues at once
- **Safe Migration**: Original labels are preserved after migration

## Installation

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd <repository-name>
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Using GitHub Copilot (Recommended)

The easiest way to create label mappings is to use GitHub Copilot. See [COPILOT_PROMPT.md](COPILOT_PROMPT.md) for detailed instructions on how to use Copilot to generate intelligent mappings.

### Manual Setup

1. Configure your GitHub App credentials (see [COPILOT_SETUP.md](COPILOT_SETUP.md))
2. Run the agent:
   ```bash
   npm start
   ```

## How It Works

1. **Analyze**: The tool scans your repository for labels that follow structured patterns
2. **Map**: AI generates intelligent mappings from labels to issue fields
3. **Preview**: Review the proposed changes and adjust mappings as needed
4. **Execute**: Apply the migration to your issues

## Example

If you have labels like:
- `priority-1`, `priority-2`, `priority-3`
- `status:todo`, `status:in-progress`, `status:done`
- `size/small`, `size/large`

The migrator will:
1. Detect these as structured labels
2. Map them to appropriate issue fields (Priority, Status, Size)
3. Update all affected issues with the field values
4. Keep the original labels intact

## Documentation

- [Copilot Integration Guide](COPILOT_PROMPT.md) - How to use GitHub Copilot for mapping
- [Setup Instructions](COPILOT_SETUP.md) - Configuration and API setup

## Requirements

- Node.js 18 or higher
- GitHub organization with Issue Fields enabled
- GitHub App with appropriate permissions (or Personal Access Token)

## License

MIT
