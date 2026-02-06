# Salesforce Flow Version Manager

A Salesforce admin tool for bulk viewing and deleting inactive flow versions. Solves the limitation of Salesforce's standard UI, which only allows deleting flow versions one at a time.

## Disclaimer

**USE AT YOUR OWN RISK.** This software is provided "as is", without warranty of any kind, express or implied. The author(s) assume no responsibility or liability for any errors, omissions, data loss, system failures, or any other damages that may result from the use of this tool.

By using this software, you acknowledge that:

- **Deleting flow versions is permanent and cannot be undone**
- You are solely responsible for verifying which versions you delete
- You should always test in a sandbox environment before using in production
- You should maintain backups of critical flows before performing bulk deletions
- The author(s) are not liable for any direct, indirect, incidental, or consequential damages

**This tool is not an official Salesforce product and is not supported by Salesforce.**

---

## Features

- View all flows in your org with version counts
- Filter by flow name, process type, or active/inactive status
- Expand flows to see all versions with details (version number, status, API version, last modified date)
- Bulk select and delete multiple inactive versions at once
- Quick links to open Flow Builder or flow detail pages
- Pagination support for orgs with hundreds of flows
- Permission-based access control

## Screenshots

*Access the tool at `/apex/FlowVersionManagerPage`*

## Installation

### Prerequisites

- [Salesforce CLI](https://developer.salesforce.com/tools/sfdxcli) installed
- A Salesforce org (works with any edition that supports Flows)

### Deploy to Your Org

1. Clone this repository:
   ```bash
   git clone https://github.com/RomanTheCube/salesforce-flow-version-manager.git
   cd salesforce-flow-version-manager
   ```

2. Authenticate to your org:
   ```bash
   sf org login web -a YourOrgAlias
   ```

3. Deploy the components:
   ```bash
   sf project deploy start --manifest manifest/package.xml --target-org YourOrgAlias
   ```

### Post-Installation Setup

#### 1. Create Remote Site Setting (Required)

The tool uses the Salesforce Tooling API for deletions, which requires a Remote Site Setting:

1. Go to **Setup > Security > Remote Site Settings**
2. Click **New Remote Site**
3. Configure:
   - **Remote Site Name:** `Salesforce_Tooling_API`
   - **Remote Site URL:** Your org's domain (e.g., `https://yourorg.my.salesforce.com`)
   - **Active:** Checked
4. Click **Save**

#### 2. Assign Permission Set

Grant access to users who need to use the tool:

1. Go to **Setup > Permission Sets**
2. Find **Flow Version Manager Access**
3. Click **Manage Assignments**
4. Add users who should have access

## Usage

1. Navigate to `/apex/FlowVersionManagerPage` in your org
2. Browse the list of flows (click **Load More** to see additional flows)
3. Click on a flow row to expand and view all versions
4. Select inactive versions using the checkboxes
5. Click **Delete** to remove selected versions

### Tips

- **Active versions are protected** - You cannot accidentally delete an active flow version
- **Use filters** - Narrow down flows by name, type, or status
- **Bulk select** - Use the checkbox in the flow header to select all inactive versions for that flow

## Components Included

| Type | Component | Description |
|------|-----------|-------------|
| Apex Class | `FlowVersionManagerController` | Backend controller for flow queries and Tooling API operations |
| Apex Class | `FlowVersionManagerControllerTest` | Test coverage (100% for production deployment) |
| LWC | `flowVersionManager` | Main user interface |
| Aura App | `flowVersionManagerApp` | Lightning Out container |
| Visualforce | `FlowVersionManagerPage` | Entry point (provides proper API session) |
| Custom Permission | `Flow_Version_Manager_Access` | Access control |
| Permission Set | `Flow_Version_Manager_Access` | Assigns the custom permission |
| FlexiPage | `Flow_Version_Manager` | Lightning App Page (optional) |

## Security

- Access is controlled via the `Flow_Version_Manager_Access` custom permission
- Only users with the permission set can view or delete flow versions
- The tool uses `with sharing` to respect org security settings
- Active flow versions cannot be deleted

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Access Denied" message | Assign the **Flow Version Manager Access** permission set |
| "Session expired" error when deleting | Ensure you're accessing via `/apex/FlowVersionManagerPage` |
| Callout errors | Verify the Remote Site Setting URL matches your org's domain |


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with Salesforce Lightning Web Components and the Tooling API.
