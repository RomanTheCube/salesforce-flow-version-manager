import { LightningElement, track, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import hasAccess from '@salesforce/apex/FlowVersionManagerController.hasAccess';
import getFlowDefinitions from '@salesforce/apex/FlowVersionManagerController.getFlowDefinitions';
import getFlowVersions from '@salesforce/apex/FlowVersionManagerController.getFlowVersions';
import deleteFlowVersions from '@salesforce/apex/FlowVersionManagerController.deleteFlowVersions';

const PROCESS_TYPE_LABELS = {
    'AutoLaunchedFlow': 'Autolaunched',
    'Flow': 'Screen Flow',
    'Workflow': 'Workflow',
    'CustomEvent': 'Platform Event',
    'InvocableProcess': 'Invocable Process',
    'LoginFlow': 'Login Flow',
    'ActionPlan': 'Action Plan',
    'JourneyBuilderIntegration': 'Journey Builder',
    'ContactRequestFlow': 'Contact Request',
    'Survey': 'Survey',
    'SurveyEnrich': 'Survey Enrich',
    'Appointments': 'Appointments',
    'FSCLending': 'FSC Lending',
    'DigitalForm': 'Digital Form',
    'FieldServiceMobile': 'Field Service Mobile',
    'OrchestrationFlow': 'Orchestration',
    'RoutingFlow': 'Routing Flow',
    'ServiceCatalogItemFlow': 'Service Catalog',
    'ManagedContentFlow': 'Managed Content',
    'CheckoutFlow': 'Checkout Flow',
    'CartAsyncFlow': 'Cart Async',
    'TransactionSecurityFlow': 'Transaction Security',
    'RecordTriggeredFlow': 'Record-Triggered',
    'ScreenFlow': 'Screen Flow',
    'ScheduleTriggeredFlow': 'Schedule-Triggered'
};

export default class FlowVersionManager extends LightningElement {
    // Session ID passed from Visualforce page (required for API callouts)
    @api sessionId;

    @track flows = [];
    @track selectedVersionIds = new Set();

    isLoading = true;
    accessDenied = false;
    searchTerm = '';
    filterType = '';
    filterStatus = '';

    // Pagination
    hasMoreFlows = false;
    currentOffset = 0;
    isLoadingMore = false;

    showDeleteModal = false;
    isDeleting = false;
    deletionProgress = 0;
    deletedCount = 0;
    totalToDelete = 0;

    // Lifecycle
    connectedCallback() {
        this.checkAccessAndLoadData();
    }

    async checkAccessAndLoadData() {
        try {
            const userHasAccess = await hasAccess();
            if (!userHasAccess) {
                this.accessDenied = true;
                this.isLoading = false;
                return;
            }
            await this.loadFlows();
        } catch (error) {
            this.showError('Error checking access: ' + this.reduceError(error));
            this.accessDenied = true;
            this.isLoading = false;
        }
    }

    async loadFlows(append = false) {
        if (append) {
            this.isLoadingMore = true;
        } else {
            this.isLoading = true;
            this.currentOffset = 0;
            this.flows = [];
        }

        try {
            const response = await getFlowDefinitions({
                offsetValue: this.currentOffset,
                searchFilter: null // Server-side search not used currently
            });

            const newFlows = this.processFlowData(response.flows);

            if (append) {
                this.flows = [...this.flows, ...newFlows];
            } else {
                this.flows = newFlows;
            }

            this.hasMoreFlows = response.hasMore;
            this.currentOffset = response.totalLoaded;

        } catch (error) {
            this.showError('Error loading flows: ' + this.reduceError(error));
        } finally {
            this.isLoading = false;
            this.isLoadingMore = false;
        }
    }

    handleLoadMore() {
        this.loadFlows(true);
    }

    processFlowData(data) {
        return data.map(flow => ({
            ...flow,
            isExpanded: false,
            isLoadingVersions: false,
            expandIcon: 'utility:chevronright',
            versionLabel: flow.versionCount != null
                ? `${flow.versionCount} version${flow.versionCount !== 1 ? 's' : ''}`
                : 'Click to load',
            processTypeLabel: PROCESS_TYPE_LABELS[flow.processType] || flow.processType,
            allInactiveSelected: false,
            hasNoInactive: true, // Will be updated when versions are loaded
            versions: []
        }));
    }

    processVersionData(versions, flowName, flowRecordId) {
        return versions.map(version => ({
            ...version,
            flowName: flowName,
            flowRecordId: flowRecordId, // FlowRecord ID for detail page link
            isSelected: this.selectedVersionIds.has(version.id),
            processTypeLabel: PROCESS_TYPE_LABELS[version.processType] || version.processType,
            statusClass: version.isActive ? 'slds-m-left_xx-small slds-badge_success' : 'slds-m-left_xx-small',
            rowClass: version.isActive ? 'version-row version-active' : 'version-row',
            lastModifiedDateFormatted: this.formatDate(version.lastModifiedDate)
        }));
    }

    formatDate(dateValue) {
        if (!dateValue) return '';
        const date = new Date(dateValue);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    // Getters
    get filteredFlows() {
        let result = this.flows;

        // Search filter
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            result = result.filter(flow =>
                flow.developerName.toLowerCase().includes(term) ||
                (flow.label && flow.label.toLowerCase().includes(term))
            );
        }

        // Process type filter
        if (this.filterType) {
            result = result.filter(flow => flow.processType === this.filterType);
        }

        // Status filter (active flows have an active version)
        if (this.filterStatus) {
            const showActive = this.filterStatus === 'Active';
            result = result.filter(flow => flow.isActive === showActive);
        }

        return result;
    }

    get totalFlows() {
        return this.filteredFlows.length;
    }

    get totalVersions() {
        // Only count flows that have loaded their versions
        const loadedFlows = this.filteredFlows.filter(f => f.versionsLoaded);
        if (loadedFlows.length === 0) {
            return '—'; // Em dash to indicate unknown
        }
        const loadedCount = loadedFlows.reduce((sum, flow) => sum + (flow.versionCount || 0), 0);
        if (loadedFlows.length < this.filteredFlows.length) {
            return `${loadedCount}+ (expand flows to see all)`;
        }
        return loadedCount;
    }

    get selectedCount() {
        return this.selectedVersionIds.size;
    }

    get deleteButtonLabel() {
        return `Delete (${this.selectedCount})`;
    }

    get deleteDisabled() {
        return this.selectedCount === 0;
    }

    get noResults() {
        return !this.isLoading && this.filteredFlows.length === 0;
    }

    get deletionProgressMessage() {
        return `Deleting ${this.deletedCount} of ${this.totalToDelete}...`;
    }

    get progressBarStyle() {
        return `width: ${this.deletionProgress}%`;
    }

    get processTypeOptions() {
        const types = new Set();
        this.flows.forEach(flow => {
            if (flow.processType) {
                types.add(flow.processType);
            }
        });

        const options = [{ label: 'All Types', value: '' }];
        types.forEach(type => {
            options.push({
                label: PROCESS_TYPE_LABELS[type] || type,
                value: type
            });
        });

        return options;
    }

    get statusOptions() {
        return [
            { label: 'All Statuses', value: '' },
            { label: 'Active', value: 'Active' },
            { label: 'Inactive', value: 'Inactive' }
        ];
    }

    get loadMoreLabel() {
        return `Load More (${this.flows.length} loaded)`;
    }

    // Event Handlers
    handleSearchChange(event) {
        this.searchTerm = event.target.value;
    }

    handleFilterTypeChange(event) {
        this.filterType = event.detail.value;
    }

    handleFilterStatusChange(event) {
        this.filterStatus = event.detail.value;
    }

    async handleFlowToggle(event) {
        const flowId = event.currentTarget.dataset.flowId;
        await this.toggleFlowExpansion(flowId);
    }

    async toggleFlowExpansion(flowId) {
        const flowIndex = this.flows.findIndex(f => f.id === flowId);
        if (flowIndex === -1) return;

        const flow = this.flows[flowIndex];
        const isExpanding = !flow.isExpanded;

        // Update expansion state
        this.flows = this.flows.map((f, idx) => {
            if (idx === flowIndex) {
                return {
                    ...f,
                    isExpanded: isExpanding,
                    expandIcon: isExpanding ? 'utility:chevrondown' : 'utility:chevronright',
                    isLoadingVersions: isExpanding && !f.versionsLoaded
                };
            }
            return f;
        });

        // Load versions if expanding and not already loaded
        if (isExpanding && !flow.versionsLoaded) {
            try {
                const versions = await getFlowVersions({
                    flowDefinitionId: flowId,
                    activeVersionId: flow.activeVersionId
                });

                const processedVersions = this.processVersionData(versions, flow.developerName, flow.flowRecordId);
                const hasInactive = processedVersions.some(v => !v.isActive);

                this.flows = this.flows.map((f, idx) => {
                    if (idx === flowIndex) {
                        const versionCount = processedVersions.length;
                        return {
                            ...f,
                            versions: processedVersions,
                            versionsLoaded: true,
                            isLoadingVersions: false,
                            hasNoInactive: !hasInactive,
                            allInactiveSelected: this.checkAllInactiveSelected(processedVersions),
                            versionCount: versionCount,
                            versionLabel: `${versionCount} version${versionCount !== 1 ? 's' : ''}`
                        };
                    }
                    return f;
                });
            } catch (error) {
                this.showError('Error loading versions: ' + this.reduceError(error));
                this.flows = this.flows.map((f, idx) => {
                    if (idx === flowIndex) {
                        return { ...f, isLoadingVersions: false };
                    }
                    return f;
                });
            }
        }
    }

    checkAllInactiveSelected(versions) {
        const inactiveVersions = versions.filter(v => !v.isActive);
        return inactiveVersions.length > 0 &&
               inactiveVersions.every(v => this.selectedVersionIds.has(v.id));
    }

    stopPropagation(event) {
        event.stopPropagation();
    }

    handleVersionSelect(event) {
        const versionId = event.target.dataset.versionId;
        const isChecked = event.target.checked;

        if (isChecked) {
            this.selectedVersionIds.add(versionId);
        } else {
            this.selectedVersionIds.delete(versionId);
        }

        // Force reactivity
        this.selectedVersionIds = new Set(this.selectedVersionIds);

        this.updateVersionSelection(versionId, isChecked);
        this.updateFlowSelectionState();
    }

    updateVersionSelection(versionId, isSelected) {
        this.flows = this.flows.map(flow => ({
            ...flow,
            versions: flow.versions.map(version =>
                version.id === versionId ? { ...version, isSelected } : version
            )
        }));
    }

    updateFlowSelectionState() {
        this.flows = this.flows.map(flow => {
            if (!flow.versionsLoaded) return flow;
            const inactiveVersions = flow.versions.filter(v => !v.isActive);
            const allInactiveSelected = inactiveVersions.length > 0 &&
                inactiveVersions.every(v => this.selectedVersionIds.has(v.id));
            return { ...flow, allInactiveSelected };
        });
    }

    handleSelectFlowInactive(event) {
        event.stopPropagation();
        const flowId = event.target.dataset.flowId;
        const isChecked = event.target.checked;

        this.flows = this.flows.map(flow => {
            if (flow.id === flowId && flow.versionsLoaded) {
                const updatedVersions = flow.versions.map(version => {
                    if (!version.isActive) {
                        if (isChecked) {
                            this.selectedVersionIds.add(version.id);
                        } else {
                            this.selectedVersionIds.delete(version.id);
                        }
                        return { ...version, isSelected: isChecked };
                    }
                    return version;
                });
                return { ...flow, versions: updatedVersions, allInactiveSelected: isChecked };
            }
            return flow;
        });

        // Force reactivity
        this.selectedVersionIds = new Set(this.selectedVersionIds);
    }

    handleDeleteClick() {
        if (this.selectedCount > 0) {
            this.showDeleteModal = true;
        }
    }

    handleOpenFlowBuilder(event) {
        const versionId = event.target.dataset.versionId;
        // Open Flow Builder for this specific version
        const url = `/builder_platform_interaction/flowBuilder.app?flowId=${versionId}`;
        window.open(url, '_blank');
    }

    handleOpenFlowRecord(event) {
        const flowId = event.target.dataset.flowId;
        // Open Flow Record detail page (parent flow, not specific version)
        const url = `/lightning/r/FlowRecord/${flowId}/view`;
        window.open(url, '_blank');
    }

    handleCancelDelete() {
        this.showDeleteModal = false;
    }

    async handleConfirmDelete() {
        this.isDeleting = true;
        this.deletedCount = 0;
        this.totalToDelete = this.selectedCount;
        this.deletionProgress = 0;

        const idsToDelete = Array.from(this.selectedVersionIds);

        try {
            // Pass session ID from VF page for proper API authentication
            const result = await deleteFlowVersions({
                flowVersionIds: idsToDelete,
                sessionId: this.sessionId
            });

            this.deletedCount = result.successCount;
            this.deletionProgress = 100;

            if (result.failureCount === 0) {
                this.showSuccess(`Successfully deleted ${result.successCount} flow version(s).`);
            } else {
                this.showWarning(
                    `Deleted ${result.successCount} version(s). Failed to delete ${result.failureCount} version(s).`
                );

                result.results.filter(r => !r.success).forEach(r => {
                    console.error(`Failed to delete ${r.flowVersionId}: ${r.errorMessage}`);
                });
            }

            // Clear selections and reload
            this.selectedVersionIds = new Set();
            await this.loadFlows();

        } catch (error) {
            this.showError('Error deleting flow versions: ' + this.reduceError(error));
        } finally {
            this.isDeleting = false;
            this.showDeleteModal = false;
        }
    }

    // Toast helpers
    showSuccess(message) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Success',
            message,
            variant: 'success'
        }));
    }

    showWarning(message) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Warning',
            message,
            variant: 'warning'
        }));
    }

    showError(message) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Error',
            message,
            variant: 'error',
            mode: 'sticky'
        }));
    }

    reduceError(error) {
        if (typeof error === 'string') {
            return error;
        }
        if (error.body && error.body.message) {
            return error.body.message;
        }
        if (error.message) {
            return error.message;
        }
        return JSON.stringify(error);
    }
}
