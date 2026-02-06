/**
 * Controller for the Bulk Flow Version Manager LWC
 * Provides methods to query flow versions via standard SOQL and delete via Tooling API
 * Restricted to users with Flow_Version_Manager_Access custom permission
 */
public with sharing class FlowVersionManagerController {

    private static final String TOOLING_API_VERSION = 'v62.0';
    private static final Integer VERSIONS_LIMIT = 200;

    /**
     * Wrapper class for flow definition (without versions for initial load)
     */
    public class FlowDefinitionWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String flowRecordId; // FlowRecord object Id for detail page link
        @AuraEnabled public String developerName;
        @AuraEnabled public String label;
        @AuraEnabled public String activeVersionId;
        @AuraEnabled public String description;
        @AuraEnabled public String namespacePrefix;
        @AuraEnabled public String processType;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public List<FlowVersionWrapper> versions;
        @AuraEnabled public Integer versionCount;
        @AuraEnabled public Boolean versionsLoaded;
    }

    /**
     * Wrapper class for individual flow version
     */
    public class FlowVersionWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String durableId;
        @AuraEnabled public String definitionId;
        @AuraEnabled public String flowName;
        @AuraEnabled public Integer versionNumber;
        @AuraEnabled public String status;
        @AuraEnabled public String description;
        @AuraEnabled public String processType;
        @AuraEnabled public String apiVersion;
        @AuraEnabled public Datetime lastModifiedDate;
        @AuraEnabled public String lastModifiedBy;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public Boolean isDeletable;
    }

    /**
     * Wrapper class for delete operation results
     */
    public class DeleteResult {
        @AuraEnabled public String flowVersionId;
        @AuraEnabled public Boolean success;
        @AuraEnabled public String errorMessage;
    }

    /**
     * Wrapper class for batch delete response
     */
    public class BatchDeleteResponse {
        @AuraEnabled public Integer totalRequested;
        @AuraEnabled public Integer successCount;
        @AuraEnabled public Integer failureCount;
        @AuraEnabled public List<DeleteResult> results;
    }

    /**
     * Wrapper class for paginated flow definitions response
     */
    public class FlowDefinitionsResponse {
        @AuraEnabled public List<FlowDefinitionWrapper> flows;
        @AuraEnabled public Boolean hasMore;
        @AuraEnabled public Integer totalLoaded;
    }

    /**
     * Check if current user has access via the Flow_Version_Manager_Access custom permission
     */
    @AuraEnabled(cacheable=true)
    public static Boolean hasAccess() {
        return FeatureManagement.checkPermission('Flow_Version_Manager_Access');
    }

    /**
     * Get flow definitions with pagination support
     * @param offsetValue Number of records to skip (for pagination)
     * @param searchFilter Optional search term to filter by ApiName
     * @return FlowDefinitionsResponse with flows and pagination info
     */
    @AuraEnabled
    public static FlowDefinitionsResponse getFlowDefinitions(Integer offsetValue, String searchFilter) {
        // Security check
        if (!hasAccess()) {
            throw new AuraHandledException('Access denied. You need the "Flow Version Manager Access" permission set to use this tool.');
        }

        try {
            FlowDefinitionsResponse response = new FlowDefinitionsResponse();
            response.flows = new List<FlowDefinitionWrapper>();

            Integer queryOffset = offsetValue != null ? offsetValue : 0;
            Integer pageSize = 200;

            // Build dynamic query to support optional search filter
            String query = 'SELECT DurableId, ApiName, Label, Description, ProcessType, ' +
                          'ActiveVersionId, NamespacePrefix, IsActive ' +
                          'FROM FlowDefinitionView ' +
                          'WHERE IsTemplate = false ';

            if (String.isNotBlank(searchFilter)) {
                String searchTerm = '%' + String.escapeSingleQuotes(searchFilter) + '%';
                query += 'AND (ApiName LIKE :searchTerm OR Label LIKE :searchTerm) ';
            }

            query += 'ORDER BY ApiName LIMIT :pageSize OFFSET :queryOffset';

            // Collect API names to query FlowRecord
            Set<String> apiNames = new Set<String>();
            List<FlowDefinitionView> flowDefs = Database.query(query);

            for (FlowDefinitionView def : flowDefs) {
                apiNames.add(def.ApiName);
            }

            // Query FlowRecord to get the correct record IDs for detail page links
            Map<String, Id> flowRecordIdsByApiName = new Map<String, Id>();
            if (!apiNames.isEmpty()) {
                for (FlowRecord fr : [
                    SELECT Id, ApiName
                    FROM FlowRecord
                    WHERE ApiName IN :apiNames
                ]) {
                    flowRecordIdsByApiName.put(fr.ApiName, fr.Id);
                }
            }

            // Build response with FlowRecord IDs
            for (FlowDefinitionView def : flowDefs) {
                FlowDefinitionWrapper wrapper = new FlowDefinitionWrapper();
                wrapper.id = def.DurableId;
                wrapper.flowRecordId = flowRecordIdsByApiName.get(def.ApiName);
                wrapper.developerName = def.ApiName;
                wrapper.label = def.Label;
                wrapper.description = def.Description;
                wrapper.activeVersionId = def.ActiveVersionId;
                wrapper.namespacePrefix = def.NamespacePrefix;
                wrapper.processType = def.ProcessType;
                wrapper.isActive = def.IsActive;
                wrapper.versions = new List<FlowVersionWrapper>();
                wrapper.versionCount = null; // Will be populated when versions are loaded
                wrapper.versionsLoaded = false;
                response.flows.add(wrapper);
            }

            // Check if there are more records
            response.hasMore = response.flows.size() == pageSize;
            response.totalLoaded = queryOffset + response.flows.size();

            return response;

        } catch (Exception e) {
            throw new AuraHandledException('Error fetching flow definitions: ' + e.getMessage());
        }
    }

    /**
     * Get versions for a specific flow definition (lazy load on expand)
     */
    @AuraEnabled
    public static List<FlowVersionWrapper> getFlowVersions(String flowDefinitionId, String activeVersionId) {
        // Security check
        if (!hasAccess()) {
            throw new AuraHandledException('Access denied. You need the "Flow Version Manager Access" permission set to use this tool.');
        }

        if (String.isBlank(flowDefinitionId)) {
            throw new AuraHandledException('Flow definition ID is required.');
        }

        try {
            List<FlowVersionWrapper> versions = new List<FlowVersionWrapper>();

            for (FlowVersionView ver : [
                SELECT DurableId, FlowDefinitionViewId, VersionNumber, Status,
                       Description, ProcessType, ApiVersionRuntime, LastModifiedDate,
                       RunInMode
                FROM FlowVersionView
                WHERE FlowDefinitionViewId = :flowDefinitionId
                ORDER BY VersionNumber DESC
                LIMIT :VERSIONS_LIMIT
            ]) {
                FlowVersionWrapper versionWrapper = new FlowVersionWrapper();
                versionWrapper.id = ver.DurableId;
                versionWrapper.durableId = ver.DurableId;
                versionWrapper.definitionId = ver.FlowDefinitionViewId;
                versionWrapper.versionNumber = ver.VersionNumber;
                versionWrapper.status = ver.Status;
                versionWrapper.description = ver.Description;
                versionWrapper.processType = ver.ProcessType;
                versionWrapper.apiVersion = ver.ApiVersionRuntime != null ? String.valueOf(ver.ApiVersionRuntime) : '';
                versionWrapper.lastModifiedDate = ver.LastModifiedDate;
                versionWrapper.lastModifiedBy = '';

                // Determine if this version is active
                versionWrapper.isActive = (activeVersionId != null &&
                                           ver.DurableId != null &&
                                           activeVersionId == ver.DurableId);
                // Can delete if not active and status is not 'Active'
                versionWrapper.isDeletable = !versionWrapper.isActive && ver.Status != 'Active';

                versions.add(versionWrapper);
            }

            return versions;

        } catch (Exception e) {
            throw new AuraHandledException('Error fetching flow versions: ' + e.getMessage());
        }
    }

    /**
     * Delete multiple flow versions via Tooling API
     * Uses session ID passed from Visualforce page for proper API authentication
     * @param flowVersionIds List of Flow version DurableIds to delete
     * @param sessionId Session ID from Visualforce page (has full API permissions)
     * @return BatchDeleteResponse with results for each deletion
     */
    @AuraEnabled
    public static BatchDeleteResponse deleteFlowVersions(List<String> flowVersionIds, String sessionId) {
        // Security check
        if (!hasAccess()) {
            throw new AuraHandledException('Access denied. You need the "Flow Version Manager Access" permission set to use this tool.');
        }

        if (flowVersionIds == null || flowVersionIds.isEmpty()) {
            throw new AuraHandledException('No flow versions selected for deletion.');
        }

        // Use provided session ID or fall back to UserInfo (may not work in Lightning)
        String apiSessionId = String.isNotBlank(sessionId) ? sessionId : UserInfo.getSessionId();

        if (String.isBlank(apiSessionId)) {
            throw new AuraHandledException('Unable to obtain session for API operations. Please access this tool via the Visualforce page.');
        }

        BatchDeleteResponse batchResponse = new BatchDeleteResponse();
        batchResponse.totalRequested = flowVersionIds.size();
        batchResponse.successCount = 0;
        batchResponse.failureCount = 0;
        batchResponse.results = new List<DeleteResult>();

        // Process deletions
        for (String flowVersionId : flowVersionIds) {
            DeleteResult result = deleteSingleFlowVersion(flowVersionId, apiSessionId);
            batchResponse.results.add(result);

            if (result.success) {
                batchResponse.successCount++;
            } else {
                batchResponse.failureCount++;
            }
        }

        return batchResponse;
    }

    /**
     * Delete a single flow version via Tooling API
     */
    private static DeleteResult deleteSingleFlowVersion(String flowVersionId, String sessionId) {
        DeleteResult result = new DeleteResult();
        result.flowVersionId = flowVersionId;

        try {
            String baseUrl = URL.getOrgDomainUrl().toExternalForm();
            String endpoint = baseUrl + '/services/data/' + TOOLING_API_VERSION + '/tooling/sobjects/Flow/' + flowVersionId;

            HttpRequest req = new HttpRequest();
            req.setEndpoint(endpoint);
            req.setMethod('DELETE');
            req.setHeader('Authorization', 'Bearer ' + sessionId);
            req.setHeader('Content-Type', 'application/json');

            Http http = new Http();
            HttpResponse res = http.send(req);

            if (res.getStatusCode() == 204 || res.getStatusCode() == 200) {
                result.success = true;
            } else if (res.getStatusCode() == 401) {
                result.success = false;
                result.errorMessage = 'Session expired. Please access this tool via the Visualforce page: /apex/FlowVersionManagerPage';
            } else {
                result.success = false;
                result.errorMessage = parseErrorResponse(res.getBody());
            }

        } catch (System.CalloutException ce) {
            result.success = false;
            String msg = ce.getMessage();
            if (msg.contains('Unauthorized')) {
                result.errorMessage = 'Session not authorized. Please access this tool via the Visualforce page: /apex/FlowVersionManagerPage';
            } else {
                result.errorMessage = msg;
            }
        } catch (Exception e) {
            result.success = false;
            result.errorMessage = e.getMessage();
        }

        return result;
    }

    /**
     * Parse error response from Tooling API
     */
    private static String parseErrorResponse(String responseBody) {
        try {
            List<Object> errors = (List<Object>) JSON.deserializeUntyped(responseBody);
            if (!errors.isEmpty()) {
                Map<String, Object> firstError = (Map<String, Object>) errors[0];
                return (String) firstError.get('message');
            }
        } catch (Exception e) {
            try {
                Map<String, Object> errorObj = (Map<String, Object>) JSON.deserializeUntyped(responseBody);
                if (errorObj.containsKey('message')) {
                    return (String) errorObj.get('message');
                }
            } catch (Exception e2) {
                // Return raw body if all parsing fails
            }
        }
        return responseBody;
    }
}
